import { useState } from 'react';

/**
 * SpeakerControl — plays custom tones and pre-programmed samples on the Thingy:52 speaker.
 */
export default function SpeakerControl({ playTone, playSample, disabled }) {
  const [freq, setFreq] = useState(440);
  const [duration, setDuration] = useState(300);
  const [volume, setVolume] = useState(50);

  const samples = [
    { id: 0, label: 'Ringtone' },
    { id: 1, label: 'Chime' },
    { id: 2, label: 'Alarm' },
    { id: 3, label: 'Tap' },
    { id: 4, label: 'Ping' },
    { id: 5, label: 'Double Beep' },
    { id: 6, label: 'Success' },
    { id: 7, label: 'Error' },
    { id: 8, label: 'Unlock' },
  ];

  return (
    <div className="sensor-card speaker-control" style={{ '--accent': '#f43f5e' }}>
      <div className="sensor-card__header">
        <span className="sensor-card__icon" aria-hidden="true">🔊</span>
        <span className="sensor-card__label">Speaker Controller</span>
      </div>

      <div className="sensor-card__body">
        {disabled ? (
          <div className="sensor-card__waiting">Connect device to enable speaker</div>
        ) : (
          <div className="speaker-controls">
            
            {/* Tone Generator */}
            <div className="control-group">
              <h4 className="control-title">Tone Generator</h4>
              <div className="slider-row">
                <label htmlFor="freq-input">Frequency: <strong>{freq} Hz</strong></label>
                <input
                  id="freq-input"
                  type="range"
                  min="100"
                  max="4000"
                  step="20"
                  value={freq}
                  onChange={(e) => setFreq(Number(e.target.value))}
                />
              </div>
              <div className="slider-row">
                <label htmlFor="dur-input">Duration: <strong>{duration} ms</strong></label>
                <input
                  id="dur-input"
                  type="range"
                  min="50"
                  max="1500"
                  step="50"
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                />
              </div>
              <div className="slider-row">
                <label htmlFor="vol-input">Volume: <strong>{volume} %</strong></label>
                <input
                  id="vol-input"
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                />
              </div>
              <button
                id="play-tone-btn"
                className="btn-play"
                onClick={() => playTone(freq, duration, volume)}
              >
                🔔 Play Tone
              </button>
            </div>

            {/* Predefined Samples */}
            <div className="control-group">
              <h4 className="control-title">Sound Effects</h4>
              <div className="samples-grid">
                {samples.map((s) => (
                  <button
                    key={s.id}
                    id={`play-sample-${s.id}`}
                    className="btn-sample"
                    onClick={() => playSample(s.id, volume)}
                    aria-label={`Play ${s.label}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
