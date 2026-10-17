"""Harmony check for a recorded game mix.

Finds stable tonal peaks (so the noisy grass/wind/rain layers are ignored), maps them to
pitch classes and reports
  * the chroma histogram and how much tonal energy falls outside the allowed pitch classes,
  * how often simultaneous tones form a minor second / major seventh or a tritone,
  * the sensory roughness (Sethares) of the tonal content over time,
  * tuning: energy that is more than 30 cents away from equal temperament.

usage: python3 harmony.py in.wav [allowed pcs, e.g. 0,2,4,7,9] [label]
"""
import sys, wave
import numpy as np

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def load(path):
    w = wave.open(path)
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, ch).astype(np.float32) / 32768
    return x.mean(1), sr


def peaks_per_frame(x, sr, nfft=8192, hop=2048, fmin=90, fmax=5200, prom_db=14):
    win = np.hanning(nfft)
    freqs = np.fft.rfftfreq(nfft, 1 / sr)
    lo, hi = np.searchsorted(freqs, fmin), np.searchsorted(freqs, fmax)
    frames = []
    for i in range(0, len(x) - nfft, hop):
        spec = np.abs(np.fft.rfft(x[i:i + nfft] * win))
        db = 20 * np.log10(spec + 1e-9)
        # spectral floor: running median over ~±60 Hz
        k = 41
        pad = np.pad(db, k // 2, mode='edge')
        idx = np.arange(lo, hi)
        floor = np.array([np.median(pad[j:j + k]) for j in idx])
        seg = db[lo:hi]
        pk = []
        for j in range(1, len(seg) - 1):
            if seg[j] > seg[j - 1] and seg[j] >= seg[j + 1] and seg[j] - floor[j] > prom_db and seg[j] > -75:
                # parabolic interpolation for the exact frequency
                a, b, c = seg[j - 1], seg[j], seg[j + 1]
                d = 0.5 * (a - c) / (a - 2 * b + c + 1e-12)
                f = freqs[lo + j] + d * (freqs[1] - freqs[0])
                pk.append((f, 10 ** (b / 10)))
        frames.append(pk)
    return frames


def persistent(frames, need=3, cents=40):
    """Keep peaks that last for `need` consecutive frames (tones, not noise)."""
    out = []
    for t in range(len(frames)):
        keep = []
        for f, p in frames[t]:
            run = 1
            for dt in (1, 2, -1, -2):
                u = t + dt
                if 0 <= u < len(frames) and any(abs(1200 * np.log2(g / f)) < cents for g, _ in frames[u]):
                    run += 1
            if run >= need:
                keep.append((f, p))
        out.append(keep)
    return out


def roughness(pk):
    if len(pk) < 2:
        return 0.0
    pk = sorted(pk, key=lambda v: -v[1])[:14]
    r = 0.0
    for i in range(len(pk)):
        for j in range(i + 1, len(pk)):
            f1, a1 = pk[i]; f2, a2 = pk[j]
            fmin_, df = min(f1, f2), abs(f2 - f1)
            s = 0.24 / (0.0207 * fmin_ + 18.96)
            r += np.sqrt(a1 * a2) * (np.exp(-3.51 * s * df) - np.exp(-5.75 * s * df))
    tot = sum(a for _, a in pk)
    return r / (tot + 1e-12)


def main():
    path = sys.argv[1]
    allowed = set(int(v) for v in sys.argv[2].split(',')) if len(sys.argv) > 2 and sys.argv[2] else None
    label = sys.argv[3] if len(sys.argv) > 3 else path
    x, sr = load(path)
    frames = persistent(peaks_per_frame(x, sr))
    chroma = np.zeros(12)
    off_tune = 0.0
    total = 0.0
    iv = np.zeros(12)
    rough = []
    for pk in frames:
        rough.append(roughness(pk))
        for f, p in pk:
            m = 69 + 12 * np.log2(f / 440)
            pc = int(round(m)) % 12
            chroma[pc] += p
            total += p
            if abs(m - round(m)) > 0.3:
                off_tune += p
        # intervals between simultaneous tones (weighted by the quieter one)
        for i in range(len(pk)):
            for j in range(i + 1, len(pk)):
                (f1, p1), (f2, p2) = pk[i], pk[j]
                semis = int(round(abs(12 * np.log2(f2 / f1)))) % 12
                iv[semis] += min(p1, p2)
    print(f'== {label}: {len(x) / sr:.1f}s, frames with tones: {sum(1 for f in frames if f)}/{len(frames)}')
    if total <= 0:
        print('no tonal content found')
        return
    ch = 100 * chroma / total
    print('chroma %: ' + ' '.join(f'{NAMES[i]}={ch[i]:.1f}' for i in range(12)))
    if allowed is not None:
        outside = sum(ch[i] for i in range(12) if i not in allowed)
        print(f'tonal energy outside the key: {outside:.2f}%')
    ivn = 100 * iv / max(iv.sum(), 1e-12)
    print(f'intervals: m2/M7 {ivn[1] + ivn[11]:.2f}%  tritone {ivn[6]:.2f}%  M2/m7 {ivn[2] + ivn[10]:.1f}%  '
          f'3rds/6ths {ivn[3] + ivn[4] + ivn[8] + ivn[9]:.1f}%  4ths/5ths {ivn[5] + ivn[7]:.1f}%  unison/oct {ivn[0]:.1f}%')
    print(f'off-tune (>30 cents) energy: {100 * off_tune / total:.2f}%')
    r = np.array(rough)
    print(f'roughness: mean {r.mean():.4f}  p95 {np.percentile(r, 95):.4f}  max {r.max():.4f}')


if __name__ == '__main__':
    main()
