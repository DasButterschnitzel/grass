"""Noise comfort check: how pleasant are the noisy layers (grass, wind, rain, waves ...)?

Rough psychoacoustic proxies, numpy only and uncalibrated (0 dBFS sine = 90 dB SPL is
assumed) - meant for comparing recordings of the game with each other, before / after:

  loudness    short-term level (400 ms), its spread (p90 - p10) and the steepest rise
              within half a second (sudden swells are what makes noise intrusive)
  balance     energy share per band and a Zwicker/DIN 45692 style sharpness in acum
              (above ~1.8 acum noise starts to sound hissy / harsh)
  modulation  envelope modulation (% RMS) per frequency region in four modulation bands:
              0.1-0.5 Hz swells, 0.5-2 Hz gusts, 2-10 Hz flutter (fluctuation strength,
              the most attention-grabbing), 10-40 Hz rattle / roughness
  clicks      sudden 3 ms bursts > 10 dB above their surroundings, per second, per region
  repetition  correlation of the spectrogram with itself 1-15 s later (audible loops)

usage: python3 noisecheck.py in.wav [t0] [t1]
"""
import sys, wave
import numpy as np

BARK_EDGES = [20, 100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720, 2000, 2320,
              2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500]
REGIONS = [('low', 60, 250), ('body', 250, 1000), ('mid', 1000, 4000), ('air', 4000, 12000)]


def load(path):
    w = wave.open(path)
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, ch).astype(np.float64) / 32768
    return x.mean(1), sr


def stft_power(x, nfft, hop):
    win = np.hanning(nfft)
    n = 1 + (len(x) - nfft) // hop
    idx = np.arange(nfft)[None, :] + hop * np.arange(n)[:, None]
    return np.abs(np.fft.rfft(x[idx] * win, axis=1)) ** 2 / (win ** 2).sum()


def band_rows(freqs, lo, hi):
    return (freqs >= lo) & (freqs < hi)


def loudness(x, sr):
    # 400 ms windows every 100 ms; simple K-weighting stand-in: -6 dB/oct below 150 Hz
    P = stft_power(x, 16384, int(0.1 * sr))
    f = np.fft.rfftfreq(16384, 1 / sr)
    w = np.where(f < 150, (f / 150) ** 2, 1.0) * np.where(f > 2000, 1.5, 1.0)  # +1.8 dB presence
    lev = 10 * np.log10((P * w).sum(1) / 16384 * 2 + 1e-12)
    rise = max((lev[i + 5] - lev[i] for i in range(len(lev) - 5)), default=0)
    return lev, rise


def sharpness(x, sr, cal=90.0):
    P = stft_power(x, 8192, 4096).mean(0)
    f = np.fft.rfftfreq(8192, 1 / sr)
    norm = 2 / 8192
    N = []
    for z in range(len(BARK_EDGES) - 1):
        r = band_rows(f, BARK_EDGES[z], BARK_EDGES[z + 1])
        E = P[r].sum() * norm
        L = 10 * np.log10(E + 1e-20) + cal + 3  # dBFS (sine peak 1 -> -3 dB) to dB SPL
        fc = np.sqrt(BARK_EDGES[z] * BARK_EDGES[z + 1]) / 1000
        tq = 3.64 * fc ** -0.8 - 6.5 * np.exp(-0.6 * (fc - 3.3) ** 2) + 1e-3 * fc ** 4
        e, etq = 10 ** (L / 10), 10 ** (tq / 10)
        N.append(max(0.0, 0.08 * (etq ** 0.23) * ((0.5 + 0.5 * e / etq) ** 0.23 - 1)))
    N = np.array(N)
    z = np.arange(len(N)) + 0.5
    g = np.where(z <= 15.8, 1.0, 0.15 * np.exp(0.42 * (z - 15.8)) + 0.85)
    S = 0.11 * (N * g * z).sum() / (N.sum() + 1e-12)
    return S, N.sum()


def _mod(x, sr):
    nfft, hop = 1024, 128
    P = stft_power(x, nfft, hop)
    f = np.fft.rfftfreq(nfft, 1 / sr)
    fs = sr / hop
    out = {}
    for name, lo, hi in REGIONS:
        env = np.sqrt(P[:, band_rows(f, lo, hi)].sum(1))
        if env.mean() < 1e-6:
            continue
        m = env / env.mean() - 1
        M = np.fft.rfft(m)
        mf = np.fft.rfftfreq(len(m), 1 / fs)
        res = []
        for a, b in [(0.1, 0.5), (0.5, 2), (2, 10), (10, 40)]:
            part = np.fft.irfft(np.where((mf >= a) & (mf < b), M, 0), len(m))
            res.append(np.mean(part ** 2))
        out[name] = res
    return out


def modulation(x, sr):
    # Noise always flickers a little by itself. Compare with a phase-randomised copy (same
    # spectrum, no structure in time) and report only the modulation beyond that, in %.
    rng = np.random.default_rng(1)
    X = np.fft.rfft(x)
    sur = np.fft.irfft(np.abs(X) * np.exp(2j * np.pi * rng.random(len(X))), len(x))
    a, b = _mod(x, sr), _mod(sur, sr)
    return {k: [100 * np.sqrt(max(0.0, p - q)) for p, q in zip(a[k], b.get(k, [0] * 4))] for k in a}


def clicks(x, sr):
    nfft, hop = 256, 128  # ~3 ms
    P = stft_power(x, nfft, hop)
    f = np.fft.rfftfreq(nfft, 1 / sr)
    fs = sr / hop
    out = {}
    k = int(0.1 * fs) | 1
    from numpy.lib.stride_tricks import sliding_window_view
    for name, lo, hi in [('mid 1-4k', 1000, 4000), ('air 4-12k', 4000, 12000)]:
        e = 10 * np.log10(P[:, band_rows(f, lo, hi)].sum(1) + 1e-14)
        med = np.median(sliding_window_view(np.pad(e, (k // 2, k // 2), mode='edge'), k), axis=1)
        hit = (e - med > 10) & (e > -75)
        ev = np.sum(hit[1:] & ~hit[:-1])
        out[name] = ev / (len(x) / sr)
    return out


def repetition(x, sr):
    # a looped buffer shows up as a sharp peak of the spectrogram's self-similarity at the
    # loop length, standing out from its neighbourhood (slow changes give a smooth curve)
    nfft, hop = 2048, 512
    P = stft_power(x, nfft, hop)
    f = np.fft.rfftfreq(nfft, 1 / sr)
    edges = np.geomspace(80, 12000, 33)
    B = np.stack([P[:, band_rows(f, edges[i], edges[i + 1])].sum(1) for i in range(32)], 1)
    B = np.log(B + 1e-12)
    B = (B - B.mean(0)) / (B.std(0) + 1e-9)
    fs = sr / hop
    lags = range(int(0.8 * fs), min(int(15.5 * fs), len(B) // 2))
    c = np.array([np.mean(np.sum(B[:-L] * B[L:], 1) / B.shape[1]) for L in lags])
    w = int(0.4 * fs)
    best, lag = 0.0, 0.0
    for i in range(w, len(c) - w):
        prom = c[i] - 0.5 * (c[i - w:i - w // 2].mean() + c[i + w // 2:i + w].mean())
        if prom > best:
            best, lag = prom, lags[i] / fs
    return best, lag


def report(path, t0=0.0, t1=None):
    x, sr = load(path)
    t1 = t1 or len(x) / sr
    x = x[int(t0 * sr):int(t1 * sr)]
    lev, rise = loudness(x, sr)
    S, Nsum = sharpness(x, sr)
    P = stft_power(x, 8192, 4096).mean(0)
    f = np.fft.rfftfreq(8192, 1 / sr)
    tot = P.sum()
    shares = {n: 100 * P[band_rows(f, lo, hi)].sum() / tot for n, lo, hi in REGIONS}
    cent = (P * f).sum() / tot
    print(f"== {path} ({t1 - t0:.0f}s)")
    print(f"loudness  mean {lev.mean():6.1f} dB  spread p10-p90 {np.percentile(lev, 90) - np.percentile(lev, 10):4.1f} dB  "
          f"steepest rise/0.5s {rise:4.1f} dB")
    print(f"balance   " + "  ".join(f"{k} {v:4.1f}%" for k, v in shares.items()) + f"  centroid {cent:5.0f} Hz  sharpness {S:4.2f} acum  (~{Nsum:4.1f} sone)")
    mod = modulation(x, sr)
    print("modulation % beyond steady noise  [swell .1-.5 | gust .5-2 | flutter 2-10 | rattle 10-40 Hz]")
    for k, v in mod.items():
        print(f"   {k:5s} " + "  ".join(f"{a:5.1f}" for a in v))
    c = clicks(x, sr)
    print("clicks/s  " + "  ".join(f"{k} {v:5.1f}" for k, v in c.items()))
    r, lag = repetition(x, sr)
    print(f"repeat    {r:4.2f} at {lag:4.1f}s  (peak above its surroundings; >0.1 = a loop you can hear)")


if __name__ == '__main__':
    report(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.0, float(sys.argv[3]) if len(sys.argv) > 3 else None)
