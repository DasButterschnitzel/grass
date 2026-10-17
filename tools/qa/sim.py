"""Fast economy simulation for balancing (mirrors js/economy.js + the core of js/game.js).

An "efficient human" mower steers towards the tallest grass nearby, extra mowers follow in V
formation, the lawn regrows, every full round pays a bonus. Purchases: upgrades while they
cost less than a fraction of the next lawn, then the lawn as soon as it is affordable.

usage: python3 sim.py [lawns] [boost_fraction] [json overrides]
"""
import sys, json, math
import numpy as np

P = dict(
    # upgrades: base, growth, max  (same numbers as js/economy.js)
    blade=(15, 2.3, 45), engine=(12, 2.3, 45), fert=(25, 2.2, 10**9), sprinkler=(20, 2.55, 40),
    # lawns
    vm=6.0, c0=5300.0, a=0.85, b=2.2, c=3.3, rinf=0.98,
    spend=0.2,      # buy upgrades while cheaper than this fraction of the next lawn
    round_bonus=0.5,
)


def stats(u):
    return dict(
        radius=2.0 + 0.09 * u['blade'],
        speed=11 + 0.3 * u['engine'],
        regrow=0.05 * (1 + 0.15 * u['sprinkler']),
        mult=1 + u['fert'],
        mowers=1 + u['fleet'],
    )


def lawn_value(N):
    return P['vm'] ** (N - 1)


def lawn_cost(N):
    c = P['c0']
    for k in range(1, N):
        c *= P['vm'] * P['rinf'] * (1 + P['a'] / k + P['b'] * math.exp(-(k - 1) / P['c']))
    return c


COSTS = {}


def fleet_cost(lvl):
    n = [3, 6, 10][lvl]
    return 0.6 * (COSTS[n] if n in COSTS else lawn_cost(n))


def fleet_unlock(lvl):
    return [3, 6, 10][lvl]


def width(N):
    return min(60, 34 + 2 * (N - 1))


def up_cost(k, l):
    if k == 'auto':  # a quarter of a lawn per level, max 10
        return 0.25 * lawn_cost(l + 1) if l < 10 else math.inf
    b, g, m = P[k]
    return b * g ** l if l < m else math.inf


def run(lawns=20, boost=0.0, seed=1, verbose=True, design=None, guess=None):
    rng = np.random.default_rng(seed)
    u = dict(blade=0, engine=0, fert=0, sprinkler=0, fleet=0, auto=0)
    cash = 0.0
    t_total = 0.0
    out = []
    dt = 1 / 12
    for N in range(1, lawns + 1):
        W = width(N); H = round(W * 1.6)
        yy, xx = np.mgrid[0:H, 0:W]
        mask = (((xx + 0.5) / W * 2 - 1) ** 2 / 0.92 + ((yy + 0.5) / H * 2 - 1) ** 2 / 0.95) < 1
        maxL = min(4, 1 + N // 2)
        target = 1 + min(1.6, 0.3 * (N - 1))
        noise = rng.random((H, W))
        layers = np.clip(np.round(1 + (target - 1) * (0.35 + noise * 1.3)), 1, maxL) * mask
        h = layers.copy().astype(np.float64)
        jit = 0.75 + 0.5 * rng.random((H, W))
        passed = np.zeros_like(mask)
        round_earn = 0.0
        V = lawn_value(N)
        cost = guess[N] if guess else lawn_cost(N)
        t = 0.0
        mx, my = W / 2, H * 0.7
        ang = 0.0
        followers = []
        rounds = 0
        while True:
            st = stats(u)
            R = st['radius']; spd = st['speed']
            # leader: steer to tallest nearby grass (coarse 4x4 blocks)
            if int(t / dt) % 6 == 0:
                bh = np.add.reduceat(np.add.reduceat(h * mask, np.arange(0, H, 4), axis=0), np.arange(0, W, 4), axis=1)
                by, bx = np.mgrid[0:bh.shape[0], 0:bh.shape[1]]
                cx, cy = bx * 4 + 2, by * 4 + 2
                d = np.hypot(cx - mx, cy - my)
                score = bh / (d + 3) ** 1.35
                j = np.unravel_index(np.argmax(score), score.shape)
                tx, ty = cx[j], cy[j]
            dx, dy = tx - mx, ty - my
            dd = math.hypot(dx, dy)
            if dd > 0.1:
                s = min(spd, dd * 7) * dt
                mx += dx / dd * s; my += dy / dd * s
                ang = math.atan2(dx, -dy)
            mx = min(max(mx, 0.5), W - 0.5); my = min(max(my, 0.5), H - 0.5)
            pos = [(mx, my)]
            fx, fy = math.sin(ang), -math.cos(ang)
            rx, ry = math.cos(ang), math.sin(ang)
            for k, (ox, oy) in enumerate([(-1.75, 1.0), (1.75, 1.0), (-3.5, 2.0)][:u['fleet']]):
                px = mx + rx * ox * R - fx * oy * R; py = my + ry * ox * R - fy * oy * R
                pos.append((min(max(px, 0.5), W - 0.5), min(max(py, 0.5), H - 0.5)))
            earned = 0.0
            mult = st['mult'] * V * (2 if rng.random() < boost else 1)
            for (px, py) in pos:
                x0, x1 = max(0, int(px - R)), min(W - 1, int(px + R))
                y0, y1 = max(0, int(py - R)), min(H - 1, int(py + R))
                sub = h[y0:y1 + 1, x0:x1 + 1]
                cy_, cx_ = np.mgrid[y0:y1 + 1, x0:x1 + 1]
                circ = ((cx_ + 0.5 - px) ** 2 + (cy_ + 0.5 - py) ** 2 <= R * R) & mask[y0:y1 + 1, x0:x1 + 1] & (sub >= 0.35)
                earned += sub[circ].sum() * mult
                sub[circ] = 0
                passed[y0:y1 + 1, x0:x1 + 1] |= circ
            # regrowth
            h = np.minimum(layers, h + st['regrow'] * dt * jit)
            cash += earned; round_earn += earned
            if passed.sum() >= 0.98 * mask.sum():
                bonus = round_earn * P['round_bonus']
                cash += bonus
                rounds += 1
                passed[:] = False; round_earn = 0.0
            t += dt
            # purchases (every 0.5 s)
            if int(t / dt) % 6 == 0:
                while True:
                    best = None
                    for k in ('blade', 'engine', 'fert', 'sprinkler', 'auto'):
                        c = up_cost(k, u[k])
                        if best is None or c < best[1]:
                            best = (k, c)
                    fc = fleet_cost(u['fleet']) if u['fleet'] < 3 and N >= fleet_unlock(u['fleet']) else math.inf
                    if fc <= cash and fc < cost * 0.9:
                        cash -= fc; u['fleet'] += 1; continue
                    if best[1] <= cash and best[1] <= P['spend'] * cost:
                        cash -= best[1]; u[best[0]] += 1; continue
                    break
            if design is not None and t >= design[N]:
                cost = cash  # the price that makes this lawn take exactly the target time
                cash = 0.0
                break
            if design is None and cash >= cost:
                cash -= cost
                break
            if t > 3600:
                break
        t_total += t
        out.append((N, t, t_total, dict(u), cost, rounds, W))
        if verbose:
            print(f"lawn {N:2d} W={W:2d} {t:6.0f}s total {t_total/60:6.1f}min cost {cost:9.3g} rounds {rounds:2d} "
                  f"blade {u['blade']:2d} eng {u['engine']:2d} fert {u['fert']:3d} spr {u['sprinkler']:2d} fleet {u['fleet']} auto {u['auto']:2d}")
    return out


def target(N):
    return [0, 70, 95, 115, 135, 150, 165, 180, 190, 200, 210, 220, 230, 240, 245, 250][N] if N <= 15 else 250 + 3 * (N - 15)


def design(lawns, boost=0.0):
    """Find lawn prices that make lawn N take target(N) seconds; fit the price formula."""
    T = {N: target(N) for N in range(1, lawns + 1)}
    guess = {N: lawn_cost(N) for N in range(1, lawns + 2)}
    for it in range(3):
        COSTS.clear(); COSTS.update(guess)
        out = run(lawns, boost, verbose=False, design=T, guess=guess)
        guess = {o[0]: o[4] for o in out}
        guess[lawns + 1] = guess[lawns] * guess[lawns] / guess[lawns - 1]
    for o in out:
        N = o[0]
        print(f"lawn {N:2d}: target {T[N]:4d}s  price {o[4]:10.3g}  ratio {o[4] / (out[N - 2][4] if N > 1 else 1):6.2f}  "
              f"blade {o[3]['blade']:2d} eng {o[3]['engine']:2d} fert {o[3]['fert']:3d} spr {o[3]['sprinkler']:2d} fleet {o[3]['fleet']} rounds {o[5]}")
    return out


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'design':
        if len(sys.argv) > 3:
            for k, v in json.loads(sys.argv[3]).items():
                P[k] = tuple(v) if isinstance(v, list) else v
        design(int(sys.argv[2]))
        sys.exit()
    lawns = int(sys.argv[1]) if len(sys.argv) > 1 else 20
    boost = float(sys.argv[2]) if len(sys.argv) > 2 else 0.0
    if len(sys.argv) > 3:
        for k, v in json.loads(sys.argv[3]).items():
            P[k] = tuple(v) if isinstance(v, list) else v
    run(lawns, boost)
