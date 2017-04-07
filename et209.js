"use strict";

/*

  This class simulates the entire digital logic of the ET209 synthesizer chip,
  which serves as the Audio Processing Unit of the Eiling Technologies ARS. It
  is 100% accurate, except that it assumes no writes to the register memory can
  occur mid-sample. This should have no noticeable effect on the output.

  In the ARS, the ET209 is clocked at 6.1425MHz. It generates one output sample
  per 128 clocks. Therefore, the correct sample rate to use is 47988.28125Hz.
  It ends up generating 799.8046875 each frame. For most emulation purposes,
  48000Hz and 800 samples per frame is "accurate enough".

 */

function ET209() {
    this.write_voice_rate = function write_voice_rate(voice, rate) {
        this._voices[voice].target_rate = rate&65535;
    }
    this.write_voice_waveform = function write_voice_waveform(voice, waveform) {
        this._voices[voice].waveform = waveform&255;
    }
    this.write_voice_volume = function write_voice_volume(voice, volume) {
        this._voices[voice].volume = volume&255;
    }
    this.write_noise_period = function write_noise_period(period) {
        this._noise.period = period&255;
        this._noise.accumulator = 0;
    }
    this.write_noise_volume = function write_noise_volume(volume) {
        this._noise.volume = volume&255;
    }
    this.reset = function reset() {
        this._voices = [];
        for(var n = 0; n < ET209.NUM_VOICES; ++n) {
            this._voices[n] = {target_rate:0,waveform:0,volume:0,
                               real_rate:0,accumulator:0};
        }
        this._noise = {period:0,volume:0,lfsr:1,accumulator:0};
        this._sample_number = 0;
        this._last_sample_lp = 0;
        this._last_sample_hp = 0;
    }
    var eval_waveform = function eval_waveform(accum, waveform) {
        var ret;
        if(waveform & ET209.WAVEFORM_OUTPUT_ACCUMULATOR_FLAG) ret = accum >>10;
        else ret = 0;
        if((waveform & ET209.WAVEFORM_INVERT_EIGHTH_FLAG) && !(accum&0xE000))
            ret ^= 63;
        if((waveform & ET209.WAVEFORM_INVERT_QUARTER_FLAG) && !(accum&0xC000))
            ret ^= 63;
        if((waveform & ET209.WAVEFORM_INVERT_HALF_FLAG) && !(accum&0x8000))
            ret ^= 63;
        if(waveform & ET209.WAVEFORM_INVERT_ALL_FLAG)
            ret ^= 63;
        return ret;
    }
    var q6_multiply = function q6_multiply(a, b) {
        if(b & 64) return a - 32; // ET209's multiplier saturates at B≥64
        else return ((a-32)*b)>>6;
    }
    // Generates a single sample, WITHOUT filtering, in the range -256 to 248.
    // (If you add 256 to this sample, you get a value in the range 0 to 504,
    // which is the actual range of the samples generated by the ET209.)
    this.generate_sample = function generate_sample() {
        var sample = 0;
        for(var voice_index = 0; voice_index < ET209.NUM_VOICES;++voice_index){
            var voice = this._voices[voice_index];
            var shift_rate = voice.target_rate >> 14;
            var actual_target_rate = voice.target_rate & 0x3FFF;
            if(shift_rate == 0)
                voice.real_rate = actual_target_rate;
            else {
                if((sample_number & ((1<<shift_rate)-1)) == 0) {
                    if(voice.real_rate < actual_target_rate) ++voice.real_rate;
                    else if(voice.real_rate > actual_target_rate)
                        --voice.real_rate;
                }
            }
            if(voice.volume & ET209.VOLUME_RESET_FLAG) {
                voice.volume &= ~ET209.VOLUME_RESET_FLAG;
                voice.accumulator = 0;
            }
            else {
                var nuccumulator = voice.accumulator + voice.real_rate + 1;
                if(nuccumulator >= 65536
                   &&voice.waveform&ET209.WAVEFORM_TOGGLE_INVERT_ON_CARRY_FLAG)
                    voice.waveform ^= ET209.WAVEFORM_INVERT_ALL_FLAG;
                voice.accumulator = nuccumulator & 65535;
            }
            sample += q6_multiply(eval_waveform(voice.accumulator,
                                                voice.waveform),
                                  voice.volume & 127)
        }
        var noise_sum = 0;
        if(this._noise.volume & ET209.VOLUME_RESET_FLAG) {
            this._noise_volume &= ~ET209.VOLUME_RESET_FLAG;
            this._noise.lfsr = 1;
        }
        for(var step = 0; step < 8; ++step) {
            noise_sum += (this._noise.lfsr&1);
            if(this._noise.accumulator == this._noise.period) {
                this._noise.accumulator = 0;
                var feedback = ((this._noise.lfsr>>1)^this._noise.lfsr)&1;
                this._noise.lfsr >>= 1;
                if(feedback) this._noise.lfsr |= 16384;
            }
            else ++this._noise.accumulator;
        }
        sample += q6_multiply(noise_sum|(noise_sum<<3),
                              this._noise.volume&127);
        ++this._sample_number;
        return sample;
    }
    var FILTER_COEFFICIENT_LOWPASS = Math.exp(-1/(ET209.SAMPLE_RATE*0.000024));
    var FILTER_COEFFICIENT_HIGHPASS =Math.exp(-1/(ET209.SAMPLE_RATE*0.075));
    // Fills up an array or array-like object with samples, WITH filtering.
    this.generate_array = function generate_array(data, length) {
        for(var frame = 0; frame < length; ++frame) {
            var sample = this.generate_sample() * (1/256);
            // low-pass filter
            sample = sample + (this._last_sample_lp - sample)
                * FILTER_COEFFICIENT_LOWPASS;
            this._last_sample_lp = sample;
            // high-pass filter
            sample = (this._last_sample_hp - sample)
                * FILTER_COEFFICIENT_HIGHPASS;
            this._last_sample_hp = sample;
            data[frame] = sample;
        }
    }
    // Fills up an AudioBuffer with samples, WITH filtering. Assumes it is a
    // mono AudioBuffer.
    this.generate_buffer = function generate_buffer(outbuffer) {
        var data = outbuffer.getChannelData(0);
        var length = outbuffer.length;
        this.generate_array(data, length);
    }
    this.reset();
}
ET209.NUM_VOICES = 7;
ET209.RATE_INSTANT_CHANGE = 0x0000;
ET209.RATE_FAST_SLIDE = 0x4000;
ET209.RATE_MEDIUM_SLIDE = 0x8000;
ET209.RATE_SLOW_SLIDE = 0xC000;
ET209.WAVEFORM_INVERT_EIGHTH_FLAG = 1;
ET209.WAVEFORM_INVERT_QUARTER_FLAG = 2;
ET209.WAVEFORM_INVERT_HALF_FLAG = 4;
ET209.WAVEFORM_INVERT_ALL_FLAG = 8;
ET209.WAVEFORM_TOGGLE_INVERT_ON_CARRY_FLAG = 16;
ET209.WAVEFORM_OUTPUT_ACCUMULATOR_FLAG = 32;
ET209.VOLUME_MAX = 64;
ET209.VOLUME_RESET_FLAG = 128;
ET209.SAMPLE_RATE = 47988.28125;
