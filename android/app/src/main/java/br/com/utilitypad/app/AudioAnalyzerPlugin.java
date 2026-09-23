package br.com.utilitypad.app;

import android.content.Context;
import android.media.AudioFormat;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;

@CapacitorPlugin(name = "AudioAnalyzer")
public class AudioAnalyzerPlugin extends Plugin {

    @PluginMethod
    public void analyze(PluginCall call) {
        String value = call.getString("uri");
        if (value == null || value.trim().isEmpty()) {
            call.reject("URI da música não informada");
            return;
        }

        Context context = getContext().getApplicationContext();
        new Thread(() -> {
            try {
                Analysis result = analyzeAudio(context, Uri.parse(value));
                JSObject data = new JSObject();
                if (result.bpm > 0) data.put("bpm", result.bpm);
                if (result.key != null) data.put("key", result.key);
                data.put("bpmConfidence", result.bpmConfidence);
                data.put("keyConfidence", result.keyConfidence);
                data.put("secondsAnalyzed", result.secondsAnalyzed);
                call.resolve(data);
            } catch (Exception error) {
                call.reject("Não foi possível analisar esta música", error);
            }
        }, "pulsar-audio-analysis").start();
    }

    private static final class Analysis {
        int bpm;
        String key;
        double bpmConfidence;
        double keyConfidence;
        double secondsAnalyzed;
    }

    private static final class FloatCollector {
        private float[] data = new float[262144];
        private int size = 0;

        void add(float value) {
            if (size >= data.length) {
                float[] grown = new float[data.length + Math.max(131072, data.length / 2)];
                System.arraycopy(data, 0, grown, 0, data.length);
                data = grown;
            }
            data[size++] = value;
        }

        int size() { return size; }

        float[] toArray() {
            float[] result = new float[size];
            System.arraycopy(data, 0, result, 0, size);
            return result;
        }
    }

    private Analysis analyzeAudio(Context context, Uri uri) throws Exception {
        final long startUs = 5_000_000L;
        final long windowUs = 55_000_000L;
        final int targetRate = 11025;
        final int maxTargetSamples = targetRate * 55;

        MediaExtractor extractor = new MediaExtractor();
        MediaCodec codec = null;
        FloatCollector collector = new FloatCollector();
        int effectiveRate = targetRate;

        try {
            extractor.setDataSource(context, uri, null);
            int audioTrack = -1;
            MediaFormat inputFormat = null;
            for (int i = 0; i < extractor.getTrackCount(); i++) {
                MediaFormat candidate = extractor.getTrackFormat(i);
                String mime = candidate.getString(MediaFormat.KEY_MIME);
                if (mime != null && mime.startsWith("audio/")) {
                    audioTrack = i;
                    inputFormat = candidate;
                    break;
                }
            }
            if (audioTrack < 0 || inputFormat == null) throw new IllegalArgumentException("Faixa de áudio não encontrada");

            String mime = inputFormat.getString(MediaFormat.KEY_MIME);
            if (mime == null) throw new IllegalArgumentException("Formato de áudio desconhecido");

            extractor.selectTrack(audioTrack);
            long durationUs = inputFormat.containsKey(MediaFormat.KEY_DURATION) ? inputFormat.getLong(MediaFormat.KEY_DURATION) : 0L;
            long actualStartUs = durationUs > 20_000_000L ? Math.min(startUs, Math.max(0L, durationUs / 8L)) : 0L;
            long endUs = durationUs > 0 ? Math.min(durationUs, actualStartUs + windowUs) : actualStartUs + windowUs;
            extractor.seekTo(actualStartUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);

            codec = MediaCodec.createDecoderByType(mime);
            codec.configure(inputFormat, null, null, 0);
            codec.start();

            boolean inputDone = false;
            boolean outputDone = false;
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
            int channels = inputFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT) ? Math.max(1, inputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)) : 2;
            int outputRate = inputFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE) ? inputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) : 44100;
            int pcmEncoding = AudioFormat.ENCODING_PCM_16BIT;
            int decimation = Math.max(1, Math.round(outputRate / (float) targetRate));
            effectiveRate = Math.max(1000, outputRate / decimation);
            long decodedFrames = 0;
            long idleLoops = 0;

            while (!outputDone && collector.size() < maxTargetSamples && idleLoops < 1000) {
                boolean progressed = false;

                if (!inputDone) {
                    int inputIndex = codec.dequeueInputBuffer(8000);
                    if (inputIndex >= 0) {
                        progressed = true;
                        ByteBuffer input = codec.getInputBuffer(inputIndex);
                        if (input == null) {
                            codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                            inputDone = true;
                        } else {
                            input.clear();
                            long sampleTime = extractor.getSampleTime();
                            if (sampleTime < 0 || sampleTime >= endUs) {
                                codec.queueInputBuffer(inputIndex, 0, 0, Math.max(0, sampleTime), MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                inputDone = true;
                            } else {
                                int sampleSize = extractor.readSampleData(input, 0);
                                if (sampleSize < 0) {
                                    codec.queueInputBuffer(inputIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                    inputDone = true;
                                } else {
                                    codec.queueInputBuffer(inputIndex, 0, sampleSize, sampleTime, extractor.getSampleFlags());
                                    extractor.advance();
                                }
                            }
                        }
                    }
                }

                int outputIndex = codec.dequeueOutputBuffer(info, 8000);
                if (outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    progressed = true;
                    MediaFormat outputFormat = codec.getOutputFormat();
                    if (outputFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = Math.max(1, outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT));
                    if (outputFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) outputRate = Math.max(1000, outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE));
                    if (outputFormat.containsKey(MediaFormat.KEY_PCM_ENCODING)) pcmEncoding = outputFormat.getInteger(MediaFormat.KEY_PCM_ENCODING);
                    decimation = Math.max(1, Math.round(outputRate / (float) targetRate));
                    effectiveRate = Math.max(1000, outputRate / decimation);
                } else if (outputIndex >= 0) {
                    progressed = true;
                    ByteBuffer output = codec.getOutputBuffer(outputIndex);
                    if (output != null && info.size > 0 && info.presentationTimeUs >= actualStartUs) {
                        output.position(info.offset);
                        output.limit(info.offset + info.size);
                        output.order(ByteOrder.LITTLE_ENDIAN);
                        if (pcmEncoding == AudioFormat.ENCODING_PCM_FLOAT) {
                            FloatBuffer floats = output.asFloatBuffer();
                            int frameCount = floats.remaining() / channels;
                            for (int frame = 0; frame < frameCount && collector.size() < maxTargetSamples; frame++) {
                                float mono = 0f;
                                for (int c = 0; c < channels; c++) mono += floats.get();
                                mono /= channels;
                                if ((decodedFrames++ % decimation) == 0) collector.add(clamp(mono));
                            }
                        } else {
                            ShortBuffer shorts = output.asShortBuffer();
                            int frameCount = shorts.remaining() / channels;
                            for (int frame = 0; frame < frameCount && collector.size() < maxTargetSamples; frame++) {
                                float mono = 0f;
                                for (int c = 0; c < channels; c++) mono += shorts.get() / 32768f;
                                mono /= channels;
                                if ((decodedFrames++ % decimation) == 0) collector.add(clamp(mono));
                            }
                        }
                    }
                    outputDone = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
                    codec.releaseOutputBuffer(outputIndex, false);
                }

                idleLoops = progressed ? 0 : idleLoops + 1;
            }
        } finally {
            try { extractor.release(); } catch (Exception ignored) {}
            if (codec != null) {
                try { codec.stop(); } catch (Exception ignored) {}
                try { codec.release(); } catch (Exception ignored) {}
            }
        }

        float[] samples = collector.toArray();
        if (samples.length < effectiveRate * 6) throw new IllegalArgumentException("Áudio curto demais para análise");
        removeDc(samples);

        Analysis result = new Analysis();
        double[] tempo = estimateTempo(samples, effectiveRate);
        result.bpm = (int) Math.round(tempo[0]);
        result.bpmConfidence = tempo[1];
        KeyResult key = estimateKey(samples, effectiveRate);
        result.key = key.key;
        result.keyConfidence = key.confidence;
        result.secondsAnalyzed = samples.length / (double) effectiveRate;
        return result;
    }

    private static float clamp(float value) {
        return Math.max(-1f, Math.min(1f, value));
    }

    private static void removeDc(float[] samples) {
        double mean = 0;
        for (float value : samples) mean += value;
        mean /= Math.max(1, samples.length);
        for (int i = 0; i < samples.length; i++) samples[i] -= (float) mean;
    }

    private static double[] estimateTempo(float[] samples, int rate) {
        int frame = 512;
        int hop = 256;
        if (samples.length < frame * 4) return new double[]{0, 0};
        int count = 1 + (samples.length - frame) / hop;
        double[] energy = new double[count];
        for (int i = 0; i < count; i++) {
            int start = i * hop;
            double sum = 0;
            for (int j = 0; j < frame; j++) {
                double value = samples[start + j];
                sum += value * value;
            }
            energy[i] = Math.sqrt(sum / frame);
        }

        double[] onset = new double[count];
        double mean = 0;
        for (int i = 2; i < count; i++) {
            double local = (energy[i - 1] + energy[i - 2]) * 0.5;
            onset[i] = Math.max(0, energy[i] - local);
            mean += onset[i];
        }
        mean /= Math.max(1, count - 2);
        for (int i = 0; i < count; i++) onset[i] = Math.max(0, onset[i] - mean * 0.35);

        double envelopeRate = rate / (double) hop;
        double bestScore = -1;
        double secondScore = -1;
        int bestBpm = 0;
        for (int bpm = 55; bpm <= 190; bpm++) {
            int lag = Math.max(1, (int) Math.round(envelopeRate * 60.0 / bpm));
            double score = correlation(onset, lag);
            int doubleLag = lag * 2;
            if (doubleLag < onset.length / 2) score += 0.28 * correlation(onset, doubleLag);
            if (lag >= 4) score += 0.12 * correlation(onset, Math.max(1, lag / 2));
            if (score > bestScore) {
                secondScore = bestScore;
                bestScore = score;
                bestBpm = bpm;
            } else if (score > secondScore) {
                secondScore = score;
            }
        }

        if (bestBpm <= 0) return new double[]{0, 0};
        double confidence = bestScore <= 0 ? 0 : Math.max(0, Math.min(1, (bestScore - Math.max(0, secondScore)) / bestScore * 4.0));
        return new double[]{bestBpm, confidence};
    }

    private static double correlation(double[] values, int lag) {
        if (lag <= 0 || lag >= values.length - 4) return 0;
        double xy = 0, xx = 0, yy = 0;
        for (int i = lag; i < values.length; i++) {
            double a = values[i];
            double b = values[i - lag];
            xy += a * b;
            xx += a * a;
            yy += b * b;
        }
        double denom = Math.sqrt(xx * yy);
        return denom > 1e-12 ? xy / denom : 0;
    }

    private static final class KeyResult {
        String key;
        double confidence;
        KeyResult(String key, double confidence) { this.key = key; this.confidence = confidence; }
    }

    private static KeyResult estimateKey(float[] samples, int rate) {
        final String[] names = {"C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"};
        final double[] major = {6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88};
        final double[] minor = {6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17};
        double[] chroma = new double[12];

        int window = Math.min(4096, highestPowerOfTwo(Math.max(1024, rate / 2)));
        int available = samples.length - window;
        int windows = Math.min(28, Math.max(8, available / Math.max(1, rate)));
        if (available <= 0) return new KeyResult(null, 0);

        for (int w = 0; w < windows; w++) {
            double fraction = windows == 1 ? 0.5 : (0.08 + 0.84 * w / (double) (windows - 1));
            int start = Math.max(0, Math.min(available, (int) Math.round(available * fraction)));
            double[] local = new double[12];
            for (int midi = 40; midi <= 83; midi++) {
                double freq = 440.0 * Math.pow(2.0, (midi - 69) / 12.0);
                if (freq >= rate * 0.45) continue;
                double magnitude = goertzel(samples, start, window, rate, freq);
                local[midi % 12] += Math.sqrt(Math.max(0, magnitude));
            }
            double total = 0;
            for (double value : local) total += value;
            if (total > 1e-9) {
                for (int i = 0; i < 12; i++) chroma[i] += local[i] / total;
            }
        }

        double total = 0;
        for (double value : chroma) total += value;
        if (total <= 1e-9) return new KeyResult(null, 0);
        for (int i = 0; i < 12; i++) chroma[i] /= total;

        double best = -Double.MAX_VALUE;
        double second = -Double.MAX_VALUE;
        int bestTonic = 0;
        boolean bestMinor = false;
        for (int tonic = 0; tonic < 12; tonic++) {
            double majorScore = profileCorrelation(chroma, major, tonic);
            double minorScore = profileCorrelation(chroma, minor, tonic);
            if (majorScore > best) {
                second = best; best = majorScore; bestTonic = tonic; bestMinor = false;
            } else if (majorScore > second) second = majorScore;
            if (minorScore > best) {
                second = best; best = minorScore; bestTonic = tonic; bestMinor = true;
            } else if (minorScore > second) second = minorScore;
        }

        double confidence = Math.max(0, Math.min(1, (best - second) * 2.5));
        return new KeyResult(names[bestTonic] + (bestMinor ? "m" : ""), confidence);
    }

    private static int highestPowerOfTwo(int value) {
        int result = 1;
        while (result <= value / 2) result <<= 1;
        return result;
    }

    private static double goertzel(float[] samples, int start, int length, int rate, double frequency) {
        double omega = 2.0 * Math.PI * frequency / rate;
        double coeff = 2.0 * Math.cos(omega);
        double q1 = 0, q2 = 0;
        for (int i = 0; i < length; i++) {
            double window = 0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / Math.max(1, length - 1));
            double q0 = samples[start + i] * window + coeff * q1 - q2;
            q2 = q1;
            q1 = q0;
        }
        return Math.max(0, q1 * q1 + q2 * q2 - coeff * q1 * q2);
    }

    private static double profileCorrelation(double[] chroma, double[] profile, int tonic) {
        double meanA = 0, meanB = 0;
        for (int pc = 0; pc < 12; pc++) {
            meanA += chroma[pc];
            meanB += profile[(pc - tonic + 12) % 12];
        }
        meanA /= 12.0;
        meanB /= 12.0;
        double xy = 0, xx = 0, yy = 0;
        for (int pc = 0; pc < 12; pc++) {
            double a = chroma[pc] - meanA;
            double b = profile[(pc - tonic + 12) % 12] - meanB;
            xy += a * b;
            xx += a * a;
            yy += b * b;
        }
        double denom = Math.sqrt(xx * yy);
        return denom > 1e-12 ? xy / denom : -1;
    }
}
