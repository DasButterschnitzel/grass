""""Klongel" meter: pitched attacks per second in a recorded mix.

Counts the moments where a tonal component starts sharply (a pluck, bell, chime, blip):
a spectral peak with >= 12 dB prominence that rose by >= 10 dB within ~70 ms and is 6 dB
above anything at that pitch in the previous ~280 ms. Slowly swelling or beating pads, noise
(grass, wind, rain) and steady tones are ignored; a chord or a note with its overtones
counts once. Prints the rate per 10 s window.

usage: python3 klongel.py in.wav [t0] [t1]
"""
import sys, wave
import numpy as np


def load(path):
    w = wave.open(path)
    sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
    x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, ch).astype(np.float32) / 32768
    return x.mean(1), sr


def attacks(x, sr, nfft=4096, hop=1024, fmin=300, fmax=6000, prom=12.0, rise=10.0, back=3, hold=12, over=6.0):
    win = np.hanning(nfft).astype(np.float32)
    n = 1 + (len(x) - nfft) // hop
    lo, hi = int(fmin * nfft / sr), int(fmax * nfft / sr)
    db = np.empty((n, hi - lo), np.float32)
    for i in range(n):
        s = np.abs(np.fft.rfft(x[i * hop:i * hop + nfft] * win))[lo:hi]
        db[i] = 20 * np.log10(s + 1e-9)
    # local background: running median over ~ +-12 bins
    k = 25
    pad = np.pad(db, ((0, 0), (k // 2, k // 2)), mode='edge')
    from numpy.lib.stride_tricks import sliding_window_view
    bg = np.median(sliding_window_view(pad, k, axis=1), axis=2)
    events = np.zeros(n, bool)
    for i in range(back, n):
        d = db[i]
        pk = (d[1:-1] > d[:-2]) & (d[1:-1] >= d[2:]) & (d[1:-1] - bg[i, 1:-1] > prom) & (d[1:-1] > -70)
        idx = np.nonzero(pk)[0] + 1
        if len(idx) == 0:
            continue
        before = np.max(np.stack([db[i - back, idx - 1], db[i - back, idx], db[i - back, idx + 1]]), axis=0)
        # ... and louder than anything at that pitch in the last ~280 ms: a slowly beating
        # (chorused) pad partial comes back to the same level every cycle and is no attack
        j0 = max(0, i - hold)
        recent = np.max(db[j0:i - 1, :][:, np.clip(np.stack([idx - 1, idx, idx + 1]), 0, db.shape[1] - 1)], axis=(0, 1))
        if np.any((d[idx] - before > rise) & (d[idx] - recent > over)):
            events[i] = True
    # merge events closer than 60 ms
    out, last = [], -1e9
    for i in np.nonzero(events)[0]:
        t = i * hop / sr
        if t - last > 0.06:
            out.append(t)
        last = t
    return np.array(out)


if __name__ == '__main__':
    x, sr = load(sys.argv[1])
    t0 = float(sys.argv[2]) if len(sys.argv) > 2 else 0
    t1 = float(sys.argv[3]) if len(sys.argv) > 3 else len(x) / sr
    x = x[int(t0 * sr):int(t1 * sr)]
    ev = attacks(x, sr) + t0
    total = 0
    for w in np.arange(t0, t1 - 9.99, 10):
        c = np.sum((ev >= w) & (ev < w + 10))
        total += c
        print(f"t={w:6.0f}s  pitched attacks/s={c / 10:5.2f}")
    print(f"mean {len(ev) / max(1e-9, t1 - t0):.2f}/s over {t1 - t0:.0f}s")
