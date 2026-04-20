// Ajouter au registre des cartes personnalisées
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'sncf-train-card',
  name: 'SNCF Train Card',
  preview: true,
  description: 'Carte personnalisée animée pour afficher les trains SNCF avec radar de ligne.'
});

// --- CLASSE DE L'ÉDITEUR VISUEL ---
class SncfTrainCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setConfig(config) {
    this._config = { ...config };
    this.render();
  }

  render() {
    if (!this._config) return;

    this.shadowRoot.innerHTML = `
      <div class="card-config">
        <div class="field">
          <label>Titre de la carte</label>
          <input type="text" id="title" value="${this._config.title || 'Trains SNCF'}">
        </div>
        
        <div class="field">
          <label>Device ID (Requis)</label>
          <input type="text" id="device_id" value="${this._config.device_id || ''}" placeholder="Ex: 87dc6f059b...">
        </div>

        <div class="field-row">
          <div class="field">
            <label>Nombre de trains</label>
            <input type="number" id="train_lines" min="1" max="10" value="${this._config.train_lines !== undefined ? this._config.train_lines : 3}">
          </div>
          <div class="field">
            <label>Durée animation (min)</label>
            <input type="number" id="animation_duration" value="${this._config.animation_duration || 30}">
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label>Emoji Train</label>
            <input type="text" id="train_emoji" value="${this._config.train_emoji || '🚅'}">
          </div>
          <div class="field">
            <label>Emoji Gare</label>
            <input type="text" id="train_station_emoji" value="${this._config.train_station_emoji || '🚉'}">
          </div>
        </div>

        <div class="field checkbox">
          <input type="checkbox" id="train_emoji_axial_symmetry" ${this._config.train_emoji_axial_symmetry !== false ? 'checked' : ''}>
          <label>Inverser le sens du train (Symétrie)</label>
        </div>

        <div class="field checkbox highlight">
          <input type="checkbox" id="show_route_details" ${this._config.show_route_details ? 'checked' : ''}>
          <label>Afficher le plan de vol (Ligne de métro)</label>
        </div>
      </div>

      <style>
        .card-config {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .field {
          display: flex;
          flex-direction: column;
          flex: 1;
        }
        .field-row {
          display: flex;
          gap: 16px;
        }
        label {
          margin-bottom: 4px;
          color: var(--secondary-text-color);
          font-size: 12px;
          font-weight: 500;
        }
        input[type="text"], input[type="number"] {
          padding: 8px;
          border: 1px solid var(--divider-color, #e0e0e0);
          border-radius: 4px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          font-family: inherit;
        }
        .checkbox {
          flex-direction: row;
          align-items: center;
          gap: 8px;
        }
        .checkbox input {
          margin: 0;
          width: 16px;
          height: 16px;
        }
        .checkbox label {
          margin: 0;
          font-size: 14px;
          color: var(--primary-text-color);
        }
        .highlight {
          background: rgba(0, 83, 156, 0.1);
          padding: 10px;
          border-radius: 6px;
          border-left: 4px solid var(--primary-color, #00539c);
        }
      </style>
    `;

    // Écouteurs d'événements pour mettre à jour la config en direct
    this.shadowRoot.querySelectorAll('input').forEach(input => {
      input.addEventListener('change', this.valueChanged.bind(this));
      if (input.type === 'text' || input.type === 'number') {
        input.addEventListener('input', this.valueChanged.bind(this)); // Pour mise à jour fluide
      }
    });
  }

  valueChanged(ev) {
    if (!this._config || !this.hass) return;
    const target = ev.target;
    let value = target.type === 'checkbox' ? target.checked : target.value;
    
    if (target.type === 'number') {
      value = Number(value);
    }

    if (this._config[target.id] === value) return;

    this._config = { ...this._config, [target.id]: value };
    
    const event = new CustomEvent('config-changed', {
      detail: { config: this._config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }
}

customElements.define('sncf-train-card-editor', SncfTrainCardEditor);


// --- CLASSE DE LA CARTE PRINCIPALE ---
class SncfTrainCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.updateInterval = null;
    this.lastTrainSignature = null;
    this._lastRenderTime = 0;
  }

  // Lier l'éditeur à la carte
  static getConfigElement() {
    return document.createElement("sncf-train-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Trains SNCF",
      device_id: "",
      train_lines: 3,
      animation_duration: 30,
      show_route_details: true
    };
  }

  setConfig(config) {
    if (!config.device_id) {
      throw new Error('Vous devez définir le device_id');
    }
    
    const previousDeviceId = this.config ? this.config.device_id : null;
    const deviceIdChanged = previousDeviceId && previousDeviceId !== config.device_id;
    
    this.config = {
      device_id: config.device_id,
      train_lines: config.train_lines !== undefined ? config.train_lines : 3,
      title: config.title || 'Trains SNCF',
      train_emoji: config.train_emoji || '🚅',
      train_emoji_axial_symmetry: config.train_emoji_axial_symmetry !== false,
      train_station_emoji: config.train_station_emoji || '🚉',
      animation_duration: config.animation_duration || 30,
      update_interval: config.update_interval || 30000,
      show_route_details: config.show_route_details !== undefined ? config.show_route_details : false,
      ...config
    };
    
    if (deviceIdChanged) {
      this.stopUpdateTimer();
      this.startUpdateTimer();
    }
    
    this.render();
  }

  set hass(hass) {
    const previousHass = this._hass;
    this._hass = hass;
    
    if (this.config && previousHass) {
      this.checkForTrainUpdates(previousHass, hass);
    } else {
      this.render();
    }
  }

  async checkForTrainUpdates(previousHass, currentHass) {
    try {
      const currentTrains = await this.getTrainEntities();
      const currentSignature = this.createTrainSignature(currentTrains);
      
      if (currentSignature !== this.lastTrainSignature) {
        this.lastTrainSignature = currentSignature;
        this.render();
      }
    } catch (error) {
      this.render();
    }
  }

  createTrainSignature(trains) {
    return trains.map(train => 
      `${train.entity_id}:${train.attributes.departure_time}:${train.attributes.delay_minutes || 0}:${train.attributes.has_delay || false}`
    ).join('|');
  }

  connectedCallback() {
    this.startUpdateTimer();
  }

  disconnectedCallback() {
    this.stopUpdateTimer();
  }

  startUpdateTimer() {
    this.stopUpdateTimer();
    this.updateInterval = setInterval(async () => {
      if (this._hass) {
        this._lastRenderTime = 0;
        await this.render();
      }
    }, this.config.update_interval);
  }

  stopUpdateTimer() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  async getTrainEntities() {
    if (!this._hass) return [];
    
    try {
      const allEntityRegistry = await this._hass.callWS({
        type: 'config/entity_registry/list'
      });
      
      const deviceEntities = allEntityRegistry.filter(entityInfo => 
        entityInfo.device_id === this.config.device_id
      );
      
      if (!deviceEntities || deviceEntities.length === 0) return [];
      
      const trainEntities = deviceEntities
        .filter(entityInfo => entityInfo.entity_id.includes('train'))
        .map(entityInfo => this._hass.states[entityInfo.entity_id])
        .filter(entity => entity && entity.attributes && entity.attributes.departure_time);
      
      const currentTime = new Date();
      const upcomingTrains = trainEntities.filter(entity => {
        const departureTime = this.parseTime(entity.attributes.departure_time);
        return departureTime >= currentTime;
      });
      
      return upcomingTrains
        .sort((a, b) => this.parseTime(a.attributes.departure_time) - this.parseTime(b.attributes.departure_time))
        .slice(0, this.config.train_lines);
      
    } catch (error) {
      return [];
    }
  }

  parseTime(departureTime) {
    if (!departureTime) return new Date(0);
    
    if (departureTime.includes('/') && departureTime.includes(' - ')) {
      const parts = departureTime.split(' - ');
      if (parts.length === 2) {
        const dateComponents = parts[0].split('/');
        if (dateComponents.length === 3) {
          const day = parseInt(dateComponents[0]);
          const month = parseInt(dateComponents[1]) - 1;
          const year = parseInt(dateComponents[2]);
          
          const timeComponents = parts[1].split(':');
          if (timeComponents.length === 2) {
            const hour = parseInt(timeComponents[0]);
            const minute = parseInt(timeComponents[1]);
            return new Date(year, month, day, hour, minute);
          }
        }
      }
    }
    return new Date(departureTime);
  }

  calculateTrainPosition(departureTime, currentTime) {
    if (!departureTime) return -10;
    const departure = this.parseTime(departureTime);
    if (isNaN(departure.getTime())) return -10;
    
    const now = currentTime || new Date();
    const diffMinutes = (departure - now) / (1000 * 60);
    const maxMinutes = this.config.animation_duration;
    
    if (diffMinutes > maxMinutes) return -10;
    if (diffMinutes <= 0) return 100;
    
    return ((maxMinutes - diffMinutes) / maxMinutes) * 100;
  }

  formatTime(timeString) {
    if (!timeString) return 'N/A';
    const time = this.parseTime(timeString);
    if (isNaN(time.getTime())) return 'Format invalide';
    return time.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  calculateRealArrivalTime(departureTime, delayMinutes) {
    if (!departureTime || !delayMinutes || delayMinutes === 0) return null;
    const originalTime = this.parseTime(departureTime);
    const realTime = new Date(originalTime.getTime() + (delayMinutes * 60000));
    return realTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  getTrainColor(delayMinutes, hasDelay) {
    if (!hasDelay || delayMinutes === 0) return '#4caf50';
    return '#f44336';
  }

  async render() {
    if (!this._hass || !this.config) return;

    const now = Date.now();
    if (now - this._lastRenderTime < 1000) return;
    this._lastRenderTime = now;

    const trains = await this.getTrainEntities();
    
    if (trains.length === 0) {
      this.shadowRoot.innerHTML = `
        <ha-card><div class="card-content"><div class="error" style="color:#f44336; text-align:center;">Aucun train trouvé pour ce device_id.</div></div></ha-card>
      `;
      return;
    }

    const currentTime = new Date();
    const trainLinesHTML = this.renderTrainLines(trains, currentTime);
    
    this.shadowRoot.innerHTML = `
      <style>
        ha-card {
          padding: 16px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.1));
        }
        .train-card { display: flex; flex-direction: column; gap: 20px; }
        .train-header {
          display: flex; align-items: center; gap: 12px;
          font-size: 1.4em; font-weight: 600;
          color: var(--primary-color, #00539c);
          border-bottom: 2px solid var(--divider-color, #e0e0e0);
          padding-bottom: 10px;
        }
        .train-line-container { display: flex; flex-direction: column; margin-bottom: 15px; }
        .train-line { display: flex; align-items: center; position: relative; min-height: 60px; }
        
        .train-track {
          position: relative; flex: 1; height: 8px;
          background: linear-gradient(90deg, #ddd 0%, #bbb 50%, #ddd 100%);
          border-radius: 4px; margin: 0 16px;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }
        .train-track.delayed {
          background: linear-gradient(90deg, #ffcdd2 0%, #e57373 50%, #ffcdd2 100%);
        }
        .train-track::before {
          content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 2px;
          background: repeating-linear-gradient(90deg, #999 0px, #999 10px, transparent 10px, transparent 20px);
          transform: translateY(-50%);
        }
        .train-track.delayed::before {
          background: repeating-linear-gradient(90deg, #d32f2f 0px, #d32f2f 10px, transparent 10px, transparent 20px);
        }
        .train-emoji {
          position: absolute; top: -37px; transform: translateX(-50%);
          font-size: 2em; transition: left 0.5s ease-in-out; z-index: 10;
        }
        .train-emoji-axial-symmetry { transform: translateX(-50%) scaleX(-1); }
        
        .station { display: flex; flex-direction: row; align-items: center; gap: 8px; min-width: 120px; }
        .station-emoji { font-size: 1.8em; }
        .station-info { display: flex; flex-direction: column; gap: 2px; }
        .arrival-time { font-size: 1.1em; font-weight: 600; color: var(--primary-color, #00539c); }
        .original-time { text-decoration: line-through; color: var(--secondary-text-color, #666); font-size: 0.9em; }
        .real-time { color: var(--error-color, #f44336); font-weight: 700; }
        .delay-info { font-size: 0.8em; font-weight: 600; }
        .on-time { color: var(--success-color, #4caf50); }
        .delay { color: var(--error-color, #f44336); }
        
        /* DESIGN DE LA LIGNE DE METRO */
        .timeline-wrapper {
          position: relative;
          margin-top: 10px;
          padding: 0 10px;
        }
        .timeline-line {
          position: absolute;
          top: 6px;
          left: 30px;
          right: 30px;
          height: 2px;
          background: var(--primary-color, #00539c);
          opacity: 0.3;
          z-index: 1;
        }
        .timeline-line.delayed-line {
          background: var(--error-color, #f44336);
        }
        .timeline-container {
          display: flex;
          justify-content: space-between;
          position: relative;
          z-index: 2;
        }
        .timeline-stop {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 70px;
        }
        .timeline-dot {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--card-background-color, #fff);
          border: 3px solid var(--primary-color, #00539c);
          margin-bottom: 6px;
          box-sizing: border-box;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
        }
        .delayed-dot {
          border-color: var(--error-color, #f44336);
        }
        .timeline-time {
          font-size: 0.75em;
          font-weight: 700;
          color: var(--primary-text-color, #333);
          margin-bottom: 2px;
        }
        .timeline-name {
          font-size: 0.65em;
          color: var(--secondary-text-color, #666);
          text-align: center;
          line-height: 1.2;
          word-break: break-word;
        }
      </style>
      
      <ha-card>
        <div class="train-card">
          <div class="train-header"><div>${this.config.title}</div></div>
          ${trainLinesHTML}
        </div>
      </ha-card>
    `;
  }

  renderTrainLines(trains, currentTime) {
    return trains.map((train) => {
      const position = this.calculateTrainPosition(train.attributes.departure_time, currentTime);
      const delayMinutes = train.attributes.delay_minutes || 0;
      const hasDelay = train.attributes.has_delay || false;
      const trainColor = this.getTrainColor(delayMinutes, hasDelay);
      const formattedTime = this.formatTime(train.attributes.departure_time);
      const realArrivalTime = this.calculateRealArrivalTime(train.attributes.departure_time, delayMinutes);
      
      // Extraction du plan de vol (tableau)
      const stopsSchedule = train.attributes.stops_schedule || [];
      
      // Construction de la barre graphique "Métro"
      let timelineHTML = '';
      if (this.config.show_route_details && stopsSchedule.length > 0) {
        const stopsHTML = stopsSchedule.map(stop => `
          <div class="timeline-stop">
            <div class="timeline-dot ${hasDelay ? 'delayed-dot' : ''}"></div>
            <div class="timeline-time">${stop.time}</div>
            <div class="timeline-name">${stop.name}</div>
          </div>
        `).join('');
        
        timelineHTML = `
          <div class="timeline-wrapper">
            <div class="timeline-line ${hasDelay ? 'delayed-line' : ''}"></div>
            <div class="timeline-container">
              ${stopsHTML}
            </div>
          </div>
        `;
      }
      
      return `
        <div class="train-line-container">
          <div class="train-line">
            <div class="train-track ${hasDelay ? 'delayed' : ''}">
              ${position >= 0 && position <= 100 ? `
                <div class="train-emoji ${this.config.train_emoji_axial_symmetry ? "train-emoji-axial-symmetry" : ""}" 
                     style="left: ${position}%; color: ${trainColor};">
                  ${this.config.train_emoji}
                </div>
              ` : ''}
            </div>
            
            <div class="station">
              <div class="station-emoji">${this.config.train_station_emoji}</div>
              <div class="station-info">
                <div class="arrival-time-container">
                  ${hasDelay && realArrivalTime ? `
                    <div class="arrival-time original-time">${formattedTime}</div>
                    <div class="arrival-time real-time">${realArrivalTime}</div>
                  ` : `<div class="arrival-time">${formattedTime}</div>`}
                </div>
                <div class="delay-info ${hasDelay ? 'delay' : 'on-time'}">
                  ${hasDelay ? `+${delayMinutes}min` : 'À l\'heure'}
                </div>
              </div>
            </div>
          </div>
          
          ${timelineHTML}
          
        </div>
      `;
    }).join('');
  }
}

customElements.define('sncf-train-card', SncfTrainCard);