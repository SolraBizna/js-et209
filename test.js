"use strict";

var SAMPLES_PER_FRAME = 800;

var audioContext;
if(typeof(window.AudioContext) !== 'undefined')
    audioContext = new window.AudioContext();
else if(typeof(window.webkitAudioContext) !== 'undefined')
    audioContext = new window.webkitAudioContext();
else alert("AudioContext is not supported, this page is broken");

var apu, et_chime;

function generate_et_chime() {
    if(apu == null) apu = new ET209();
    // (note: the real chime is half as loud as this facsimile)
    var frames = [];
    function generate_one_frame() {
        var nuframe = new Float32Array(SAMPLES_PER_FRAME);
        apu.generate_array(nuframe, SAMPLES_PER_FRAME);
        frames.push(nuframe);
    }
    // mute all channels
    apu.write_noise_volume(ET209.VOLUME_RESET_FLAG);
    for(var n = 0; n < ET209.NUM_VOICES; ++n)
        apu.write_voice_volume(n, ET209.VOLUME_RESET_FLAG);
    // For the chime, first three voices are sawtooth, next four are squares
    for(var n = 0; n < 3; ++n)
        apu.write_voice_waveform(n, ET209.WAVEFORM_OUTPUT_ACCUMULATOR_FLAG);
    for(var n = 3; n < 7; ++n)
        apu.write_voice_waveform(n,ET209.WAVEFORM_TOGGLE_INVERT_ON_CARRY_FLAG);
    // Set the frequencies for the chime
    // E minor chord
    apu.write_voice_rate(0, 224);
    apu.write_voice_rate(1, 267);
    apu.write_voice_rate(2, 336);
    // Again, one octave up
    apu.write_voice_rate(3, 449);
    apu.write_voice_rate(4, 534);
    apu.write_voice_rate(5, 673);
    // E, one octave further up
    apu.write_voice_rate(6, 899);
    // Ramp up the first three voices in parallel over 32 frames
    for(var volume = 2; volume <= 64; volume += 2) {
        for(var voice = 0; voice < 3; ++voice) {
            apu.write_voice_volume(voice, volume);
        }
        generate_one_frame();
    }
    // Ramp up the next voices, taking 16 frames for each one
    for(var voice = 3; voice < 7; ++voice) {
        var flags = ET209.VOLUME_RESET_FLAG;
        for(var volume = 4; volume <= 64; volume += 4) {
            apu.write_voice_volume(voice, volume|flags);
            generate_one_frame();
            flags = 0;
        }
    }
    // Hold for 32 frames
    for(var n = 0; n < 32; ++n) generate_one_frame();
    // Pitch slide the center note of the chord up one semitone, ending up at
    // E major, over the course of 30 frames
    for(var n = 1; n <= 30; ++n) {
        apu.write_voice_rate(1, 267 + (n>>1));
        apu.write_voice_rate(4, 534 + n);
        generate_one_frame();
    }
    // Fade out all voices in parallel over 64 frames
    for(var volume = 63; volume >= 0; --volume) {
        for(var voice = 0; voice < 7; ++voice) {
            apu.write_voice_volume(voice, volume);
        }
        generate_one_frame();
    }
    // Okay, we've generated all the frames
    et_chime = audioContext.createBuffer(1, frames.length * SAMPLES_PER_FRAME,
                                         ET209.SAMPLE_RATE);
    if(et_chime.copyToChannel) {
        for(var frame = 0; frame < frames.length; ++frame) {
            et_chime.copyToChannel(frames[frame], 0, frame*800);
        }
    }
    else {
        var data = et_chime.getChannelData(0);
        for(var frame = 0; frame < frames.length; ++frame) {
            for(var n = 0; n < frames[frame].length; ++n) {
                data[n+frame*SAMPLES_PER_FRAME] = frames[frame][n];
            }
        }
    }
}

function clicked() {
    if(et_chime == null) generate_et_chime();
    var node = audioContext.createBufferSource();
    node.buffer = et_chime;
    node.connect(audioContext.destination);
    node.start();
}
