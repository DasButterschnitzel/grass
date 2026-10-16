import sys, wave, numpy as np
from PIL import Image
p = sys.argv[1]
w = wave.open(p); sr = w.getframerate(); n = w.getnframes(); ch = w.getnchannels()
x = np.frombuffer(w.readframes(n), dtype=np.int16).reshape(-1, ch).astype(np.float32) / 32768
mono = x.mean(1)
print(f"dur={n/sr:.2f}s peak={np.abs(x).max():.3f} rms_total={np.sqrt((mono**2).mean()):.4f}")
win = sr // 2
for i in range(0, len(mono) - win, win):
    seg = mono[i:i+win]
    rms = np.sqrt((seg**2).mean())
    spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    f = np.fft.rfftfreq(len(seg), 1/sr)
    cen = (spec * f).sum() / max(spec.sum(), 1e-9)
    bands = [(0,250),(250,1000),(1000,4000),(4000,10000),(10000,24000)]
    e = [ (spec[(f>=a)&(f<b)]**2).sum() for a,b in bands]; tot = sum(e) or 1
    print(f"t={i/sr:5.1f} rms={20*np.log10(rms+1e-9):6.1f}dB centroid={cen:6.0f}Hz bands%=" + ' '.join(f"{100*v/tot:4.1f}" for v in e))
# spectrogram image
nfft = 1024; hop = 512
frames = [mono[i:i+nfft]*np.hanning(nfft) for i in range(0, len(mono)-nfft, hop)]
S = np.abs(np.fft.rfft(np.array(frames), axis=1)).T
S = 20*np.log10(S + 1e-6); S = np.clip((S + 90) / 90, 0, 1)
img = (np.flipud(S) * 255).astype(np.uint8)
Image.fromarray(img).resize((min(1600, img.shape[1]), 400)).save(sys.argv[2])
