// מקליט קול כקובץ WAV (16kHz מונו).
// למה לא MediaRecorder? כי בכרום הוא מקליט webm, ושירותי ה-AI מקבלים בבטחה WAV/MP3/OGG.
// ‏30 שניות ≈ 1MB – מספיק לשאלה קולית.

const RATE = 16000;
const MAX_SECONDS = 60;

export async function startWavRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let length = 0;
  proc.onaudioprocess = e => {
    if (length > ctx.sampleRate * MAX_SECONDS) return;
    const d = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(d));
    length += d.length;
  };
  src.connect(proc);
  proc.connect(ctx.destination);

  return {
    async stop() {
      proc.disconnect(); src.disconnect();
      stream.getTracks().forEach(t => t.stop());
      const inRate = ctx.sampleRate;
      await ctx.close();
      const all = new Float32Array(length);
      let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      return { blob: encodeWav(downsample(all, inRate, RATE), RATE), seconds: length / inRate };
    },
  };
}

function downsample(buf, inRate, outRate) {
  if (inRate === outRate) return buf;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(buf.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio), end = Math.min(buf.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += buf[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
