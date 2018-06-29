This is an emulator for the (fictional) ET-209 digital synthesizer chip, which was used in the (fictional) Eiling Technologies Artificial Reality System, which was an overengineered, overpriced, overheating 8-bit game console (fictionally) released in the late 80's.

# API

All examples given here assume you either embedded this directly into a webpage with `<script src="et209.js">` or did something like `let ET209 = require('et209');` in your own module, depending on whether you're using a module system or not. (Note that the package name is `et209` but the canonical identifier is `ET209`.)

[This section](https://github.com/SolraBizna/ars-emu/blob/master/HARDWARE.md#apu) of the `ars-emu` README contains a lot of vital information about the ET-209.

All ranges in this document are inclusive. "0 through 3" includes the values 0, 1, 2, and 3.

Voice numbers are 0 through 6. The constant `ET209.NUM_VOICES`, with the value 7, is included for convenience.

The ET-209 does not have an inherent sample rate, but in the ARS it is clocked at precisely 135000000/2816 Hz (≈47940Hz). This value is provided as `ET209.SAMPLE_RATE` for convenience. Assuming you calculate rate values correctly, you are free to use any value you wish as your sample rate.

## Initialization

```js
apu = new ET209();
```

Creates a new instance of an ET-209 chip, which has just freshly powered on and had a nice, clean reset.

## Registers

```js
apu.write_voice_rate(voice, rate);
```

Sets the raw rate value for the given voice. `rate` should be in the range 0 to 65535. Since this is the *raw* rate value, the upper two bits are the pitch slide bits, provided as constants:

- `ET209.RATE_INSTANT_CHANGE`: Rate changes take effect instantly. (This is the default, and is defined only for readability.)
- `ET209.RATE_FAST_SLIDE`: Rate changes by 1 unit per 4 samples.
- `ET209.RATE_MEDIUM_SLIDE`: Rate changes by 1 unit per 8 samples.
- `ET209.RATE_SLOW_SLIDE`: Rate changes by 1 unit per 16 samples.

```js
apu.write_voice_waveform(voice, waveform);
```

Sets the waveform value for the given voice. `waveform` is in the range 0 to 255. The following constants may be used to build up a meaningful waveform value:

- `ET209.WAVEFORM_INVERT_EIGHTH_FLAG`: Invert the first 1/8 of the wave.
- `ET209.WAVEFORM_INVERT_QUARTER_FLAG`: Invert the first 1/4 of the wave.
- `ET209.WAVEFORM_INVERT_HALF_FLAG`: Invert the first 1/2 of the wave.
- `ET209.WAVEFORM_INVERT_ALL_FLAG`: Invert the whole wave.
- `ET209.WAVEFORM_TOGGLE_INVERT_ON_CARRY_FLAG`: Toggle `ET209.WAVEFORM_INVERT_ALL_FLAG` internally after each wavelength.
- `ET209.WAVEFORM_OUTPUT_ACCUMULATOR_FLAG`: If set, the high bits of the accumulator are outputted (and possibly inverted), forming a sawtooth wave. (Combine with `ET209.WAVEFORM_TOGGLE_INVERT_ON_CARRY_FLAG` and you have a triangle wave instead of a sawtooth wave.)
- `ET209.WAVEFORM_PAN_CENTER`: Play back at 50% volume through both stereo channels. This results in the same perceived volume as a left or right pan. (This is the default, and is defined only for clarity.)
- `ET209.WAVEFORM_PAN_LEFT`: Play back entirely in the left channel.
- `ET209.WAVEFORM_PAN_RIGHT`: Play back entirely in the right channel.
- `ET209.WAVEFORM_PAN_FULL`: Play back at full volume through both channels. This results in twice the perceived volume as a left, right, or center pan. It is mainly used for low frequency effects, particularly low frequency triangle waves, which have a relatively low perceived volume.

```js
apu.write_voice_volume(voice, volume);
```

Sets the volume value for the given voice. `volume` should be in the range 0 to 64 (`ET209.VOLUME_MAX`), optionally bitwise OR'd with the following constant:

- `ET209.VOLUME_RESET_FLAG`: If set, the accumulator will reset in the next sample, i.e. the wave will "start over". You usually want to set this for each "note on".

```js
apu.write_noise_period(period);
```

Sets the noise period to the given value. `period` is in the range 0 through 255. Higher value = lower pitched noise.

```js
apu.write_noise_waveform(waveform);
```

Sets the noise waveform to the given value. `waveform` is in the range 0 through 255. The low 7 bits are "hold bits"; the more of them are enabled, the lower the perceived noise frequency. The high bit (`ET209.PERIODIC_NOISE`) changes the noise function from white noise to periodic noise.

```js
apu.write_noise_volume(volume);
```

Sets the noise volume to the given value. `volume` should be in the range 0 to 64 (`ET209.VOLUME_MAX`), optionally bitwise OR'd with the following constant:

- `ET209.VOLUME_RESET_FLAG`: If set, the LFSR will reset during the next sample, i.e. the noise will "start over". You usually want to set this for each "note on".

## Output

There are three high-level functions for generating output samples; one for mono, one for stereo, and one for headphones. (Switching between them willy-nilly will produce a "filter glitch". For best results, stick to one when possible.)

All three of these functions produce floating-point output in the range -1 to 1.

```js
let output = [];
apu.generate_mono_array(output, length);
// OR
let output = new Float32Array(length);
apu.generate_mono_array(output, length);
```

Clocks the emulated ET-209 chip enough times to produce `length` output samples, and writes (filtered) monaural samples to the `output` array.

```js
let left_output = [];
let right_output = [];
apu.generate_stereo_arrays(left_output, right_output, length);
// OR
let left_output = new Float32Array(length);
let right_output = new Float32Array(length);
apu.generate_stereo_arrays(left_output, right_output, length);
```

Clocks the emulated ET-209 chip enough times to produce `length` output samples, and writes (filtered) stereo samples to the `left_output` and `right_output` arrays. This closely mimics the usual operating mode of a "real" ET-209.

```js
let left_output = [];
let right_output = [];
apu.generate_stereo_arrays(left_output, right_output, length);
// OR
let left_output = new Float32Array(length);
let right_output = new Float32Array(length);
apu.generate_stereo_arrays(left_output, right_output, length);
```

Clocks the emulated ET-209 chip enough times to produce `length` output samples, and writes (filtered) stereo samples to the `left_output` and `right_output` arrays. This version uses a simplistic approximation of the [HRTF](https://en.wikipedia.org/wiki/Head-related_transfer_function) to create three virtual speakers for headphone users.

### `AudioBuffer` output

```js
apu.generate_buffer(output_buffer, headphones);
```

Calls `generate_mono_array`, `generate_stereo_arrays`, or `generate_headphone_arrays` to fill `output_buffer` (an `AudioBuffer`) with output samples. Chooses between them based on the channel count of the `AudioBuffer` and the boolean value `headphones`.

## Raw Output

You probably want to use the above high-level output functions instead.

```js
let frame = [];
apu.generate_frame(frame);
```

Clocks the emulated ET-209 chip 128 times, enough to produce a single output sample, then returns the raw, unfiltered, digital output values.

The ET-209's DACs accept input in the range 0 through 511. (It will never actually exceed 504.) This function produces output such that, if you follow the below recommendations, you will arrive at values in the range -256 to 248. This is actually the correct offset, even though it seems to be biased toward the negative... let's just say it's complicated.

The real ET-209 produces two digital outputs, one for each stereo channel. This function returns four, in the following order: center, right, left, and "full".

To produce authentic stereo output:

```js
let leftSample = (frame[0] >> 1) + frame[2] + frame[3];
let rightSample = (frame[0] >> 1) + frame[1] + frame[3];
```

To produce mono output:

```js
let sample = (frame[0] + frame[1] + frame[2]) * 0.5 + frame[3];
```

The four pan values are separated. Among other things, this lets you produce 3.1 surround output:

```js
let leftSample = frame[2] + frame[3] * (1/3);
let rightSample = frame[1] + frame[3] * (1/3);
let centerSample = frame[0] + frame[3] * (1/3);
let lfeSample = frame[3];
// (LFE output should actually be low-pass filtered with a cutoff at ≈120Hz)
```

Other possibilities exist, including headphone-friendly stereo.

For compatibility with (probably extinct) old scripts that assumed mono output, there is a `generate_sample` function that returns a mono sample directly.

## Miscellaneous

```js
apu.reset();
```

Sends a reset signal to the emulated chip, and zeroes all of its registers. This does *not* reset the filter status. The physical ET-209's filters are analog components, not affected by the (digital) reset input.

```js
output = ET209.eval_waveform(accum, waveform);
```

Evaluates a voice waveform with the given accumulator value. `accum` is the value of the accumulator, in the range 0 to 65535. The returned value is the raw output of the corresponding functional unit of the ET-209, in the range 0 to 63.

This function is provided in case you want to provide waveform previews or the like.


