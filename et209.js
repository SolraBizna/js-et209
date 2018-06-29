"use strict";

/*

  This class simulates the entire digital logic of the ET209 synthesizer chip,
  which serves as the Audio Processing Unit of the Eiling Technologies ARS. It
  is 100% accurate, except that it assumes no writes to the register memory can
  occur mid-sample. This should have no noticeable effect on the output.

  In the ARS, the ET209 is clocked at 135MHz/22. It generates one output sample
  per 128 clocks. Therefore, the correct sample rate to use is 135MHz/2816, or
  about 47940Hz.

  It ends up generating 798.28125 samples each frame. For most emulation
  purposes, 48000Hz and 800 samples per frame is "accurate enough".

*/

// Using the UMD returnExports pattern.
// https://github.com/umdjs/umd/blob/master/templates/returnExports.js
(function (root, factory) {
    if(typeof define === 'function' && define.amd) {
        define([], factory);
    }
    else if(typeof module === 'object' && module.exports) {
        module.exports = factory();
    }
    else {
        // Take note!
        // When we're a browser global module, our name is ET209, *not* et209!
        root.ET209 = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    var ET209 = function ET209() {
        this.reset();
    };
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
    ET209.WAVEFORM_SIGNED_RESET_MASK = 48;
    ET209.WAVEFORM_PAN_MASK = 192;
    ET209.WAVEFORM_PAN_CENTER = 0;
    ET209.WAVEFORM_PAN_LEFT = 128;
    ET209.WAVEFORM_PAN_RIGHT = 64;
    ET209.WAVEFORM_PAN_FULL = 192;
    ET209.PERIODIC_NOISE = 0x80;
    ET209.VOLUME_MAX = 64;
    ET209.VOLUME_RESET_FLAG = 128;
    ET209.SAMPLE_RATE = 135000000/2816;
    // The ARS filters its ET-209's DAC outputs with a 2.4nF + 10kΩ low-pass RC
    // filter. This is the IIR coefficent for that filter.
    var DAC_FILTER_COEFFICIENT = Math.exp(-1/(ET209.SAMPLE_RATE*0.000024));
    // This IIR and stereo delay sample count corresponds to a 90 degree
    // "speaker separation" value in ars-emu.
    var PAN_FILTER_COEFFICIENT = 1 - (1-DAC_FILTER_COEFFICIENT) *
        (1-Math.exp(-1/(ET209.SAMPLE_RATE*0.000103)));
    var STEREO_DELAY_SAMPLE_COUNT = 23;
    var eval_waveform = function eval_waveform(accum, waveform) {
        var ret;
        if(waveform & ET209.WAVEFORM_OUTPUT_ACCUMULATOR_FLAG)
            ret = accum >>10;
        else ret = 0;
        if((waveform & ET209.WAVEFORM_INVERT_EIGHTH_FLAG)
           && !(accum&0xE000))
            ret ^= 63;
        if((waveform & ET209.WAVEFORM_INVERT_QUARTER_FLAG)
           && !(accum&0xC000))
            ret ^= 63;
        if((waveform & ET209.WAVEFORM_INVERT_HALF_FLAG)
           && !(accum&0x8000))
            ret ^= 63;
        if(waveform & ET209.WAVEFORM_INVERT_ALL_FLAG)
            ret ^= 63;
        return ret;
    };
    var q6_multiply = function _q6_multiply(a, b) {
        if(b & 64) return a - 32; // ET209's multiplier saturates at B≥64
        else return ((a-32)*b)>>6;
    };
    ET209.prototype = {
        "write_voice_rate": function write_voice_rate(voice, rate) {
            this._voices[voice].target_rate = rate&65535;
        },
        "write_voice_waveform": function write_voice_waveform(voice, waveform){
            this._voices[voice].waveform = waveform&255;
        },
        "write_voice_volume": function write_voice_volume(voice, volume) {
            this._voices[voice].volume = volume&255;
        },
        "write_noise_period": function write_noise_period(period) {
            this._noise.period = period&255;
            this._noise.accumulator = 0;
        },
        "write_noise_volume": function write_noise_volume(volume) {
            this._noise.volume = volume&255;
        },
        "write_noise_waveform": function write_noise_waveform(waveform) {
            this._noise.waveform = waveform&255;
        },
        "reset": function reset() {
            this._voices = [];
            for(var n = 0; n < ET209.NUM_VOICES; ++n) {
                this._voices[n] = {target_rate:0,waveform:0,volume:0,
                                   real_rate:0,accumulator:0};
            }
            this._noise = {period:0,volume:0,lfsr:1,accumulator:0,waveform:0};
            this._sample_number = 0;
        },
        "generate_sample": function generate_sample() {
            var out = [];
            this.generate_frame(out);
            return (out[0]+out[1]+out[2])*0.5+out[3];
        },
        "generate_frame": function generate_frame(out_frame) {
            out_frame[3] = out_frame[2] = out_frame[1] = out_frame[0] = 0;
            for(var voice_index = 0; voice_index < ET209.NUM_VOICES;
                ++voice_index) {
                var voice = this._voices[voice_index];
                var shift_rate = voice.target_rate >> 14;
                var actual_target_rate = voice.target_rate & 0x3FFF;
                if(shift_rate == 0)
                    voice.real_rate = actual_target_rate;
                else {
                    if((this._sample_number & ((1<<shift_rate<<2)-1)) == 0) {
                        if(voice.real_rate < actual_target_rate)
                            ++voice.real_rate;
                        else if(voice.real_rate > actual_target_rate)
                            --voice.real_rate;
                    }
                }
                if(voice.volume & ET209.VOLUME_RESET_FLAG) {
                    voice.volume &= ~ET209.VOLUME_RESET_FLAG;
                    if((voice.waveform & ET209.WAVEFORM_SIGNED_RESET_MASK)
                       == ET209.WAVEFORM_SIGNED_RESET_MASK)
                        voice.accumulator = 0x8000;
                    else
                        voice.accumulator = 0;
                }
                else {
                    var nuccumulator = voice.accumulator + voice.real_rate + 1;
                    if(nuccumulator >= 65536
                       && (voice.waveform
                           &ET209.WAVEFORM_TOGGLE_INVERT_ON_CARRY_FLAG))
                        voice.waveform ^= ET209.WAVEFORM_INVERT_ALL_FLAG;
                    voice.accumulator = nuccumulator & 65535;
                }
                out_frame[voice.waveform>>6]
                    += q6_multiply(eval_waveform(voice.accumulator,
                                                 voice.waveform),
                                   voice.volume & 127)
            }
            var noise_sum = 0;
            if(this._noise.volume & ET209.VOLUME_RESET_FLAG) {
                this._noise.volume &= ~ET209.VOLUME_RESET_FLAG;
                this._noise.lfsr = 1;
            }
            for(var step = 0; step < 8; ++step) {
                noise_sum += (this._noise.lfsr&1);
                if(step != 7 && (this._noise.waveform & (1<<step))) continue;
                if(this._noise.accumulator == this._noise.period) {
                    this._noise.accumulator = 0;
                    var feedback;
                    if(this._noise.waveform & 128)
                        feedback = ((this._noise.lfsr>>6)^this._noise.lfsr)&1;
                    else
                        feedback = ((this._noise.lfsr>>1)^this._noise.lfsr)&1;
                    this._noise.lfsr >>= 1;
                    if(feedback) this._noise.lfsr |= 16384;
                }
                else ++this._noise.accumulator;
            }
            out_frame[3] += q6_multiply(noise_sum|(noise_sum<<3),
                                        this._noise.volume&127);
            ++this._sample_number;
        },
        "generate_mono_array": function generate_mono_array(data, length) {
            if(this._last_sample === undefined) this._last_sample = 0;
            for(var i = 0; i < length; ++i) {
                var sample = this.generate_sample() * (1/256);
                // low-pass filter
                sample = sample + (this._last_sample - sample)
                    * DAC_FILTER_COEFFICIENT;
                this._last_sample = sample;
                data[i] = sample;
            }
        },
        "generate_stereo_arrays": function generate_stereo_arrays(data_left,
                                                                  data_right,
                                                                  length) {
            if(this._last_left_sample === undefined) {
                // assume these will always be set together
                this._last_left_sample = 0;
                this._last_right_sample = 0;
            }
            for(var i = 0; i < length; ++i) {
                var frame = [];
                this.generate_frame(frame);
                var left_sample = ((frame[0]>>1)+frame[2]+frame[3]) * (1/256);
                var right_sample = ((frame[0]>>1)+frame[1]+frame[3]) * (1/256);
                // low-pass filter
                left_sample = left_sample
                    + (this._last_left_sample - left_sample)
                    * DAC_FILTER_COEFFICIENT;
                this._last_left_sample = left_sample;
                right_sample = right_sample
                    + (this._last_right_sample - right_sample)
                    * DAC_FILTER_COEFFICIENT;
                this._last_right_sample = right_sample;
                data_left[i] = left_sample;
                data_right[i] = right_sample;
            }
        },
        "generate_headphone_arrays":
        function generate_headphone_arrays(data_left, data_right, length) {
            if(this._last_left_sample === undefined) {
                // assume these will always be set together
                this._last_left_sample = 0;
                this._last_right_sample = 0;
            }
            if(this._last_left_delayed_sample == undefined) {
                this._last_left_delayed_sample = 0;
                this._last_right_delayed_sample = 0;
                this._stereo_delay_buf_left = [];
                this._stereo_delay_buf_right = [];
                for(var n = 0; n < STEREO_DELAY_SAMPLE_COUNT; ++n) {
                    this._stereo_delay_buf_left[n] = 0;
                    this._stereo_delay_buf_right[n] = 0;
                }
            }
            for(var i = 0; i < length; ++i) {
                var frame = [];
                this.generate_frame(frame);
                var left_sample = ((frame[0]>>1)+frame[2]+frame[3]) * (1/256);
                var right_sample = ((frame[0]>>1)+frame[1]+frame[3]) * (1/256);
                // low-pass filter
                left_sample = left_sample + (this._last_left_sample - left_sample)
                    * DAC_FILTER_COEFFICIENT;
                this._last_left_sample = left_sample;
                right_sample = right_sample +(this._last_right_sample-right_sample)
                    * DAC_FILTER_COEFFICIENT;
                this._last_right_sample = right_sample;
                data_left[i] = left_sample
                    + this._stereo_delay_buf_left[this._stereo_delay_pos];
                data_right[i] = right_sample
                    + this._stereo_delay_buf_right[this._stereo_delay_pos];
                // put another sample on the delay bin
                // more aggressively filtered, and swizzled
                var left_delayed_sample = frame[1] * (1/256);
                var right_delayed_sample = frame[2] * (1/256);
                left_delayed_sample = left_delayed_sample
                    + (this._last_left_delayed_sample - left_delayed_sample)
                    * PAN_FILTER_COEFFICIENT;
                this._last_left_delayed_sample = left_delayed_sample;
                right_delayed_sample = right_delayed_sample
                    + (this._last_right_delayed_sample - right_delayed_sample)
                    * PAN_FILTER_COEFFICIENT;
                this._last_right_delayed_sample = right_delayed_sample;
                this._stereo_delay_buf_left[this._stereo_delay_pos]
                    = left_delayed_sample;
                this._stereo_delay_buf_right[this._stereo_delay_pos]
                    = right_delayed_sample;
                ++this._stereo_delay_pos;
                if(this._stereo_delay_pos == STEREO_DELAY_SAMPLE_COUNT)
                    this._stereo_delay_pos = 0;
            }
        },
        "generate_buffer": function generate_buffer(outbuffer, headphones) {
            if(outbuffer.numberOfChannels == 1) {
                var data = outbuffer.getChannelData(0);
                var length = outbuffer.length;
                this.generate_array(data, length);
            }
            else if(outbuffer.numberOfChannels == 2) {
                var data_left = outbuffer.getChannelData(0);
                var data_right = outbuffer.getChannelData(1);
                var length = outbuffer.length;
                if(headphones)
                    this.generate_headphone_arrays(data_left, data_right,
                                                   length);
                else
                    this.generate_stereo_arrays(data_left, data_right, length);
            }
            else throw "Unsupported number of channels for generate_buffer";
        },
    };
    ET209.eval_waveform = eval_waveform;
    // backwards compatibility alias
    ET209.prototype.generate_array = ET209.prototype.generate_mono_array;
    return ET209;
}));
