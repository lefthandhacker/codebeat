(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
(function (global){
const Frequency = require('./frequency');
const Duration = require('./duration');
const Note = require('./note');
const FX = require('./fx');

class SynthJS {
  /**
  * Create an instance of SynthJS.
  * @constructor
  * @param {Object} props - Initialize with tempo, timeSig, instrument, notes, and loop properties.
  */
  constructor(props) {
    this.tempo = props.tempo || 60;
    this.timeSig = props.timeSig || '4/4';
    this.instrument = props.instrument || 'sine';
    this.notes = props.notes || '';
    this.loop = props.loop || false;

    this.context = new (props.context || global.AudioContext || global.webkitAudioContext)();
    this.analyserNode = this.context.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.connect(this.context.destination);

    // used to connect oscillator nodes to output:
    // osc -> analyser -> javascript -> destination
    this.lastNode = this.analyserNode;

    this.parseNotes();
    this.getBPM();
  }

  /**
  * Update current properties.
  * @param {Object} props - Update the tempo, timeSig, instrument, notes, and/or loop properties.
  */
  update(props) {
    Object.keys(props).forEach((key) => {
      this[key] = props[key];
    });
    if (props.notes) this.parseNotes();
    if (props.timeSig) this.getBPM();

    return this;
  }

  /**
   * Exposes the current waveform data from analyser
   * Call on UI repaint (e.g. requestAnimationFrame)
   */
  getAnalyserFrequency() {
    this.analyserNode.getByteFrequencyData(this.analyserDataArray);
    return this.analyserDataArray;
  }

  /**
  * Calculate duration in seconds.
  * @param {number} duration - Note duration relative to one measure.
  * @return {number} Time of duration in seconds.
  */
  toTime(duration) {
    return (duration * this.beatsPerMeasure * 60) / this.tempo;
  }

  /**
  * Get the number of beats per measure based on the timeSig property numerator.
  * Called on initialization or update().
  */
  getBPM() {
    this.beatsPerMeasure = parseInt(this.timeSig, 10);
    return this.beatsPerMeasure;
  }

  /**
  * Open an audio context.
  * @param {string} nodeAudioContext - Required for node web audio API (used for testing).
  */
  createContext(nodeAudioContext) {
    this.context = new (nodeAudioContext || global.AudioContext || global.webkitAudioContext)();
    this.analyserNode = this.context.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserDataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.connect(this.context.destination);

    // used to connect oscillator nodes to output:
    // osc -> analyser -> javascript -> destination
    this.lastNode = this.analyserNode;
  }

  /**
  * Parse this.notes into an array of note objects.
  */
  parseNotes(rawNotes = this.notes) {
    // prepare variable names for notes w/ delimiter ;
    const motifs = SynthJS._expandMotifs(rawNotes);

    // prepare note and motif multiples w/ delimiter *
    const multiples = SynthJS._expandMultiples(motifs);

    // prepare note slides w/ delimiter -
    const slides = SynthJS._expandSlides(multiples);

    // prepare chords w/ delimiter +
    const poly = SynthJS._expandPoly(slides);

    // translate data to Note object w/ delimiter ,
    const notes = SynthJS._expandNotes(poly);

    // update or reset notesParsed
    this.notesParsed = notes;

    return notes;
  }

  /**
  * Output audio through an audio context, which closes after
  * the last oscillator node ends, or on stop().
  */
  play(n = 0) {
    const currentNote = this.notesParsed[n];
    const nextNote = this.notesParsed[n + 1];
    const stopTime = this.toTime(currentNote.outputDuration);
    const oscillators = [];
    const playNext = () => {
      return n < this.notesParsed.length - 1 ? this.play(n + 1) : this.ended();
    };

    // Is the current note an @effect?
    const effect = currentNote.effect[0];
    if (effect && effect.charAt(0) === '@') {
      // remove '@' and add effect to chain of context nodes
      FX[effect.slice(1)](this, currentNote.value);
      return playNext();
    }

    // create and configure oscillators
    currentNote.outputFrequency.forEach(f => {
      let osc = this.context.createOscillator();

      // set instrument
      osc.type = this.instrument;

      // set detune
      osc.detune.setValueAtTime(this.detune || 0, this.context.currentTime);

      // set note frequency
      osc.frequency.value = f;

      // connect oscillator first node in chain:
      // osc -> lastNode (e.g. gainNode) -> analyser -> destination
      osc.connect(this.lastNode);

      oscillators.push(osc);
    });

    oscillators.forEach(o => {
      o.start(0);

      this.getAnalyserFrequency();

      if (nextNote && currentNote.effect.includes('slide')) {
        this.slideNote(o, n);
      }

      o.stop(this.context.currentTime + stopTime);
    });

    oscillators.shift().onended = () => playNext();
  }

  /**
  * Play through the composition in reverse.
  */
  playReverse() {
    this.notesParsed.reverse();
    this.play();
  }

  /**
  * Repeat audio until stop() is called.
  */
  playLoop() {
    this.loop = true;
    this.play();
  }

  /**
  * Repeat audio in reverse until stop() is called.
  */
  playReverseLoop() {
    this.loop = true;
    this.playReverse();
  }

  /**
  * End looping and call ended().
  */
  stop() {
    this.loop = false;
    return this.ended();
  }

  /**
  * End current audio loop.
  */
  ended() {
    this.context.close().then(() => {
      this.createContext();
      if (this.loop) this.play();
      else this.parseNotes();
    })
    .catch(err => { throw new Error(err); });

    return this;
  }

  /**
  * Get a summary of note pitch names from the composition.
  * @return {Array} Sorted note names at first octave.
  */
  brief() {
    //TODO: Brief chords as well
    const singleNotes = this.notesParsed.filter(n => !n.effect.includes('poly'))
    const origin = this.notesParsed.map(f => SynthJS._originFrequency(f.outputFrequency[0]));
    const notes = origin.filter((note, i) => i === origin.indexOf(note));
    notes.sort();
    const names = notes.map(note => SynthJS._noteName(note));
    return names.filter(name => name && name !== 'rest');
  }

  /**
  * Get the length of the composition.
  * @return {number} Total time of composition in seconds.
  */
  time() {
    let time = 0;
    this.notesParsed.forEach((note) => {
      time += this.toTime(note.outputDuration) || 0;
    });
    return time;
  }

  /**
  * Get the number of times each note appears in the composition.
  * @return {Object} Total count of each note.
  */
  countNotes() {
    const count = {};
    this.notesParsed.forEach((note) => {
      if (!count[note.inputFrequency]) {
        count[note.inputFrequency] = 0;
      }
      if (count[note.inputFrequency] >= 0) {
        count[note.inputFrequency] += 1;
      }
    });
    return count;
  }

  squeeze(octave) {
    if (octave < Frequency.range[0] || octave > Frequency.range[1]) {
      return new Error("Error: octave out of range.")
    }

    this.notesParsed = this.notesParsed.map(n => {
      n.outputFrequency = n.outputFrequency.map(f => {
        let o = octave;
        const origin = SynthJS._originFrequency(f);

        if (SynthJS._noteName(origin).match(/g|f|e|c|d/)) {
          o -= 1;
        }

        return origin * Math.pow(2, o);
      });

      return n;
    });
  }

  findKey() {
    //train model with .brief() data and classifier
  }

  generate() {
    
  }

  /**
  * Get the same note in the first octave.
  * @param {number} frequency - Frequency of a note in Hz.
  * @return {number} Frequency of the same note in the first octave.
  */
  static _originFrequency(f) {
    const note = SynthJS._noteName(f)
    const origin = note.slice(0, note.length - 1) + '1'
    const originFrequency = Frequency[origin]
    return originFrequency >= 55 
           ? originFrequency / 2 
           : originFrequency
  }

  /**
  * Get the name of a note from its frequency.
  * @param {number} frequency - Frequency of a note.
  * @return {number} Name of the note.
  */
  static _noteName(f) {
    let note = '';
    Object.keys(Frequency).forEach((key) => {
      if (Frequency[key] == f) {
        note = key
      }
    });
    return note || new Error('Error: note does not exist');
  }

  static _expandMotifs(notes) {
    const motifs = {};

    if (notes.includes(';')) {
      notes = notes.split(';');
      const motifOccursAt = [];
      const operator = ':';

      notes.forEach((n, i) => {
        if (n.includes(operator)) {
          const motif = n.split(operator).map(m => m.trim());
          motifs[motif[0]] = motif[1];
          motifOccursAt.push(i);
        }
      });
      
      notes = notes
        // filter motif definitions from note collection
        .filter((n, i) => !motifOccursAt.includes(i))
        // split notes
        .join(',').split(',')
        .map(n => n.trim())
        // replace motif name with notes
        .map(n => Object.prototype.hasOwnProperty.call(motifs, n) ? motifs[n] : n)
        // merge back to one string
        .join(',');
    }

    // split into 2D array of input frequencies and durations
    notes = notes.split(',')
      .map(n => n.trim().split(' '))

    return {
      motifs,
      notes
    };
  }

  static _expandMultiples({ motifs, notes }) {
    let offset = 0;
    let l = notes.length;
    
    for (let i = 0; i < l; i += 1) {
      const next = i + offset;
      const multiply = notes[next].indexOf('*');
      if (multiply !== -1 && multiply < notes[next].length-1) {
        const note = notes[next].slice(0, multiply);
        const repeat = +notes[next][multiply + 1];
        let section = []
        while (section.length < repeat) {
          section.push(note);
        }

        section = section
          .map(s => Object.prototype.hasOwnProperty.call(motifs, s) ? motifs[s].split(' ') : s)

        notes.splice(next, 1, ...section)
        offset += repeat - 1
      }
    }

    return notes;
  }

  static _expandSlides(notes) {
    const slide = {
      occursAt: [],
      augment: 0,
    };

    notes.forEach((n, i) => {
      if (n.includes('-')) {
        slide.occursAt.push(i);
      }
    });

    slide.occursAt.forEach((i) => {
      const index = i + slide.augment;
      const s = notes.splice(index, 1)[0];
      notes.splice(index, 0, [s[0], s[1], ['slide']], [s[3], s[4], ['slide']]);
      slide.augment += 1;
    });

    return notes;
  }

  static _expandPoly(notes) {
    notes = notes.map((n, i) => {
      if (n.includes('+')) {
        const duration = n.shift()
        const pitch = n.filter(p => p !== '+').reduce((a,b) => a.concat(' ').concat(b));

        const poly = [
          duration,
          pitch,
          ['poly']
        ];

        n = poly;
      }
      return n;
    });

    return notes;
  }

  static _expandNotes(notes) {
    return notes.map(n => {
      return Note(n);
    });
  }

  slideNote(oscillator, n) {
    const nextNote = this.notesParsed[n + 1];
    if (!nextNote.effect.includes('slide')) return;

    const note = this.notesParsed[n];
    let output = note.outputFrequency[0];
    const nextOutput = nextNote.outputFrequency[0];
    const timeInterval = this.toTime(note.outputDuration) / Math.abs(nextOutput - output) * 1000;
    
    let slide = setInterval(() => {
      oscillator.frequency.value = output;
      if (output < nextOutput) {
        output += 1;
      } 
      else if (output > nextOutput) {
        output -= 1;
      } 
      else clearInterval(slide);
    }, timeInterval);
  }
}

module.exports = SynthJS;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./duration":2,"./frequency":3,"./fx":4,"./note":6}],2:[function(require,module,exports){
// base duration of 1/32
const ts = 0.03125;

module.exports = {
  // zero
  z: 0,

  // thirty-second
  ts,

  // sixteenth
  s: ts * 2,

  // dotted sixteenth
  's.': ts * 3,

  // eighth-note triplet
  t: ts * (8 / 3),

  // eighth
  e: ts * 4,

  // dotted eighth
  'e.': ts * 6,

  // quarter
  q: ts * 8,

  // dotted quarter
  'q.': ts * 12,

  // half
  h: ts * 16,

  // dotted half
  'h.': ts * 24,

  // whole
  w: ts * 32,

  // dotted whole
  'w.': ts * 48,

  // indefinite
  i: 1000.00000,
};

},{}],3:[function(require,module,exports){
// base frequency for each note
const a = 27.5;
const asharp = 29.1352;
const b = 30.8677;
const bflat = asharp;
const c = 32.7032;
const csharp = 34.6478;
const d = 36.7081;
const dflat = csharp;
const dsharp = 38.8909;
const e = 41.2034;
const eflat = dsharp;
const f = 43.6535;
const fsharp = 46.2493;
const g = 48.9994;
const gflat = fsharp;
const gsharp = 51.9131;
const aflat = gsharp;

module.exports = {
  range: [0, 8],
  lowest: a,
  heighest: gsharp * 64,
  rest: 0,
  // naturals
  a0: a,
  a1: a * 2,
  a2: a * 4,
  a3: a * 8,
  a4: a * 16,
  a5: a * 32,
  a6: a * 64,
  a7: a * 128,
  b0: b,
  b1: b * 2,
  b2: b * 4,
  b3: b * 8,
  b4: b * 16,
  b5: b * 32,
  b6: b * 64,
  b7: b * 128,
  c1: c,
  c2: c * 2,
  c3: c * 4,
  c4: c * 8,
  c5: c * 16,
  c6: c * 32,
  c7: c * 64,
  c8: c * 128,
  d1: d,
  d2: d * 2,
  d3: d * 4,
  d4: d * 8,
  d5: d * 16,
  d6: d * 32,
  d7: d * 64,
  e1: e,
  e2: e * 2,
  e3: e * 4,
  e4: e * 8,
  e5: e * 16,
  e6: e * 32,
  e7: e * 64,
  f1: f,
  f2: f * 2,
  f3: f * 4,
  f4: f * 8,
  f5: f * 16,
  f6: f * 32,
  f7: f * 64,
  g1: g,
  g2: g * 2,
  g3: g * 4,
  g4: g * 8,
  g5: g * 16,
  g6: g * 32,
  g7: g * 64,
  // sharps
  'a#0': asharp,
  'a#1': asharp * 2,
  'a#2': asharp * 4,
  'a#3': asharp * 8,
  'a#4': asharp * 16,
  'a#5': asharp * 32,
  'a#6': asharp * 64,
  'a#7': asharp * 128,
  'b#1': c,
  'b#2': c * 2,
  'b#3': c * 4,
  'b#4': c * 8,
  'b#5': c * 16,
  'b#6': c * 32,
  'b#7': c * 64,
  'b#8': c * 128,
  'c#1': csharp,
  'c#2': csharp * 2,
  'c#3': csharp * 4,
  'c#4': csharp * 8,
  'c#5': csharp * 16,
  'c#6': csharp * 32,
  'c#7': csharp * 64,
  'd#1': dsharp,
  'd#2': dsharp * 2,
  'd#3': dsharp * 4,
  'd#4': dsharp * 8,
  'd#5': dsharp * 16,
  'd#6': dsharp * 32,
  'd#7': dsharp * 64,
  'e#1': f,
  'e#2': f * 2,
  'e#3': f * 4,
  'e#4': f * 8,
  'e#5': f * 16,
  'e#6': f * 32,
  'e#7': f * 64,
  'f#1': fsharp,
  'f#2': fsharp * 2,
  'f#3': fsharp * 4,
  'f#4': fsharp * 8,
  'f#5': fsharp * 16,
  'f#6': fsharp * 32,
  'f#7': fsharp * 64,
  'g#1': gsharp,
  'g#2': gsharp * 2,
  'g#3': gsharp * 4,
  'g#4': gsharp * 8,
  'g#5': gsharp * 16,
  'g#6': gsharp * 32,
  'g#7': gsharp * 64,
  // flats
  a_1: aflat,
  a_2: aflat * 2,
  a_3: aflat * 4,
  a_4: aflat * 8,
  a_5: aflat * 16,
  a_6: aflat * 32,
  a_7: aflat * 64,
  b_0: bflat,
  b_1: bflat * 2,
  b_2: bflat * 4,
  b_3: bflat * 8,
  b_4: bflat * 16,
  b_5: bflat * 32,
  b_6: bflat * 64,
  b_7: bflat * 128,
  c_0: b,
  c_1: b * 2,
  c_2: b * 4,
  c_3: b * 8,
  c_4: b * 16,
  c_5: b * 32,
  c_6: b * 64,
  c_7: b * 128,
  d_1: dflat,
  d_2: dflat * 2,
  d_3: dflat * 4,
  d_4: dflat * 8,
  d_5: dflat * 16,
  d_6: dflat * 32,
  d_7: dflat * 64,
  e_1: eflat,
  e_2: eflat * 2,
  e_3: eflat * 4,
  e_4: eflat * 8,
  e_5: eflat * 16,
  e_6: eflat * 32,
  e_7: eflat * 64,
  f_1: e,
  f_2: e * 2,
  f_3: e * 4,
  f_4: e * 8,
  f_5: e * 16,
  f_6: e * 32,
  f_7: e * 64,
  g_1: gflat,
  g_2: gflat * 2,
  g_3: gflat * 4,
  g_4: gflat * 8,
  g_5: gflat * 16,
  g_6: gflat * 32,
  g_7: gflat * 64,
};
// end note_data object

},{}],4:[function(require,module,exports){
function createReverbBuffer(synthjs, val) {
  let values = val.split('/');
  let rate = synthjs.context.sampleRate;
  let channels = values[0] || 1;
  let length = rate * (values[1] || 1);
  let decay = values[2] || 0.5;
  let buffer = synthjs.context.createBuffer(channels, length, rate);

  for (let c = 0; c < channels; c++) {
    let channelData = buffer.getChannelData(c);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }

  return buffer;
}

function makeDistortionCurve(val) {
  let v = +val;
  let n_samples = 44100;
  let curve = new Float32Array(n_samples);
  let deg = Math.PI / 180;
  let x;

  for (let i = 0; i < n_samples; ++i ) {
    x = i * 2 / n_samples - 1;
    curve[i] = (3 + v) * x * 20 * deg / (Math.PI + v * Math.abs(x));
  }

  return curve;
}

exports.createReverbBuffer = createReverbBuffer;
exports.makeDistortionCurve = makeDistortionCurve;

exports.gain = (synthjs, val=100) => {
  const gainNode = synthjs.context.createGain();
  gainNode.gain.value = +val / 100;
  gainNode.connect(synthjs.lastNode);
  synthjs.lastNode = gainNode;
};

exports.instrument = (synthjs, val) => {
  if (!val) return synthjs.instrument;
  synthjs.instrument = val;
};

exports.detune = (synthjs, val) => {
  if (!val) return synthjs.detune;
  synthjs.detune = +val;
};

exports.reverb = (synthjs, val) => {   
  const convolverNode = synthjs.context.createConvolver();
  convolverNode.buffer = createReverbBuffer(synthjs, val);
  convolverNode.connect(synthjs.lastNode);
  synthjs.lastNode = convolverNode;
};

exports.distortion = (synthjs, val) => {
  let values = val.split('/');
  const distortionNode = synthjs.context.createWaveShaper();
  distortionNode.curve = makeDistortionCurve(values[0]);
  distortionNode.oversample = values[1];
  distortionNode.connect(synthjs.lastNode);
  synthjs.lastNode = distortionNode;
};
},{}],5:[function(require,module,exports){
const SynthJS = require('./Synth');

const edmMelody = 
`intro: 
w g1 + d3, h g1 + f3, h g1 + c4, w g1 + b3, e g1 + f4, e g1 + d4, e g1 + c5;

hook: 
e c5 - z a4, e g4, e rest, e d4, e rest, e c4, e rest,
e c5 - z a4, e g4, e rest, e d4, 
e f3 + c4 + d3, 
e f3 + c4 + d3, 
e f3 + c4 + d3, 
e f3 + c3 + d3,
e f3 + b3 + d3,
e f3 + b3 + d3,
e f3 + b3 + d3,
q rest;

@instrument sawtooth,
@distortion 15/2x,
@reverb 4/0.5/0.9,

intro, 
hook`;

const starwarsMelody =
`first: h c4, h g4;
second: t f4, t e4, t d4;
third: h c5, q g4, t f4, t e4, t f4;

@reverb 4/1.5/1.5,
@instrument sine,
t g3 * 3,
first, second,
h c5, q g4,
@reverb 1/1/20,
second, 
third,
h d4`;

const ghostbustersMelody =
`first: s c4 * 2, e e4, e c4, e d4, e b_3;
second: q rest * 2, s c4 * 4, e b_3;

first, second,
e c4, h rest,

first, second,
e d4, q c4`;

const harrypotterMelody =
`first: e. e4, s g4 - e f#4;

e b3,
first,
e. e4, s e4 - e b4,
q. a4,

q. f#4,
first,
q d#4, e f4,
q. b3`;

const edm = new SynthJS({
  tempo: 120,
  notes: edmMelody,
});

const starwars = new SynthJS({
  tempo: 120,
  notes: starwarsMelody,
});

const ghostbusters = new SynthJS({
  tempo: 116,
  notes: ghostbustersMelody,
});

const harrypotter = new SynthJS({
  tempo: 60,
  timeSig: '3/8',
  notes: harrypotterMelody,
});
$('#edm .play-btn').click(() => { edm.play() });
$('#starwars .play-btn').click(() => { starwars.play() });
$('#ghostbusters .play-btn').click(() => { ghostbusters.play() });
$('#harrypotter .play-btn').click(() => { harrypotter.play() });

$('#edm .playLoop-btn').click(() => { edm.playLoop() });
$('#starwars .playLoop-btn').click(() => { starwars.playLoop() });
$('#ghostbusters .playLoop-btn').click(() => { ghostbusters.playLoop() });
$('#harrypotter .playLoop-btn').click(() => { harrypotter.playLoop() });

$('#edm .reverse-btn').click(() => { edm.playReverse() });
$('#starwars .reverse-btn').click(() => { starwars.playReverse() });
$('#ghostbusters .reverse-btn').click(() => { ghostbusters.playReverse() });
$('#harrypotter .reverse-btn').click(() => { harrypotter.playReverse() });

$('#edm .stop-btn').click(() => { edm.stop() });
$('#starwars .stop-btn').click(() => { starwars.stop() });
$('#ghostbusters .stop-btn').click(() => { ghostbusters.stop() });
$('#harrypotter .stop-btn').click(() => { harrypotter.stop() });

$('#edm .composition').text(edmMelody);
$('#starwars .composition').text(starwarsMelody);
$('#ghostbusters .composition').text(ghostbustersMelody);
$('#harrypotter .composition').text(harrypotterMelody);

$('#edm .time').html(`<strong>Time:</strong> ${edm.time().toFixed(2)} seconds`);
$('#starwars .time').html(`<strong>Time:</strong> ${starwars.time().toFixed(2)} seconds`);
$('#ghostbusters .time').html(`<strong>Time:</strong> ${ghostbusters.time().toFixed(2)} seconds`);
$('#harrypotter .time').html(`<strong>Time:</strong> ${harrypotter.time().toFixed(2)} seconds`);

const tryItOptions = () => {
  return {
    tempo: +$('#try-it .tempo').val() || 60,
    timeSig: $('#try-it .timeSig').val() || '4/4',
    instrument: $('#try-it .instrument').val() || 'sine',
    notes: $('#try-it .composition').text(),
  };
};

const tryIt = new SynthJS(tryItOptions());

$('#try-it .play-btn').click(() => {
  tryIt.update(tryItOptions());
  tryIt.play();
  $('#try-it .time').html('<strong>Time:</strong> ' + tryIt.time().toFixed(2) + ' seconds');
});

$('#try-it .playLoop-btn').click(() => {
  tryIt.update(tryItOptions());
  tryIt.playLoop();
  $('#try-it .time').html(`<strong>Time:</strong> ${tryIt.time().toFixed(2)} seconds`);
})

$('#try-it .reverse-btn').click(() => {
  tryIt.update(tryItOptions());
  tryIt.playReverse();
  $('#try-it .time').html(`<strong>Time:</strong> ${tryIt.time().toFixed(2)} seconds`);
})

$('#try-it .stop-btn').click(() => {
  tryIt.stop();
  $('#try-it .time').html(`<strong>Time:</strong> ${tryIt.time().toFixed(2)} seconds`);
})

},{"./Synth":1}],6:[function(require,module,exports){
const Frequency = require('./frequency');
const Duration = require('./duration');

module.exports = (note) => {
	const inputDuration = note[0];
    const inputFrequency = note[1];
	const effect = note[2] || [];
	if (inputDuration[0] === '@') effect.push(inputDuration)

	let noteSchema = {};

	switch(effect[0]) {
		case 'slide':
			noteSchema = {
				effect,
				inputDuration,
				inputFrequency,
				outputDuration: Duration[inputDuration],
				outputFrequency: [Frequency[inputFrequency]],
			};
			break;

		case 'poly':
			noteSchema = {
				effect,
				inputDuration,
				inputFrequency,
				outputDuration: Duration[inputDuration],
				outputFrequency: inputFrequency.split(' ').map(f => Frequency[f]),
			};
			break;

		case '@gain':
			noteSchema = {
				effect,
				value: inputFrequency,
			};
			break;

		case '@instrument':
			noteSchema = {
				effect,
				value: inputFrequency,
			};
			break;

		case '@detune':
			noteSchema = {
				effect,
				value: inputFrequency,
			};
			break;
		
		case '@reverb':
			noteSchema = {
				effect,
				value: inputFrequency,
			};
			break;

		case '@distortion':
			noteSchema = {
				effect,
				value: inputFrequency,
			};
			break;

		default:
			noteSchema = {
				effect,
				inputDuration,
				inputFrequency,
				outputDuration: Duration[inputDuration],
				outputFrequency: [Frequency[inputFrequency]],
			};
			break;
	}
	
	return noteSchema
}
},{"./duration":2,"./frequency":3}]},{},[5]);
