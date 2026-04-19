// Ajouter au registre des cartes personnalisées
(window.customCards = window.customCards || []).push({
  type: 'sncf-train-card',
  name: 'SNCF Train Card',
  description: 'Carte personnalisée animée pour afficher les trains SNCF en temps réel'
});

class SncfTrainCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.updateInterval = null;
    this.lastTrainSignature = null;
    this._lastRenderTime = 0;
  }

  setConfig(config) {
    if (!config.device_id) {
      throw new Error('You need to define device_id');
    }
    
    const previousDeviceId = this.config ? this.config.device_id : null;
    const deviceIdChanged = previousDeviceId && previousDeviceId !== config.device_id;
    
    this.config = {
      device_id: config.device_id,
      train_lines: config.train_lines || 3,
      title: config.title || 'Trains SNCF',
      train_emoji: config.train_emoji || '🚅',
      train_emoji_axial_symmetry: config.train_emoji_axial_symmetry || true,
      train_station_emoji: config.train_station_emoji || '🚉',
      animation_duration: config.animation_duration || 30,
      update_interval: config.update_interval || 30000,
      ...config
    };
    
    // Forcer la mise à jour immédiate si device_id a changé
    if (deviceIdChanged) {
      this.stopUpdateTimer();
      this.startUpdateTimer();
    }
    
    // Toujours forcer un nouveau rendu
    this.render();
  }

  set hass(hass) {
    const previousHass = this._hass;
    this._hass = hass;
    
    // Vérifier si les données des trains ont changé
    if (this.config && previousHass) {
      this.checkForTrainUpdates(previousHass, hass);
    } else {
      this.render();
    }
  }

  async checkForTrainUpdates(previousHass, currentHass) {
    try {
      // Récupérer les entités actuelles
      const currentTrains = await this.getTrainEntities();
      
      // Créer une signature des données actuelles
      const currentSignature = this.createTrainSignature(currentTrains);
      
      // Comparer avec la signature précédente
      if (currentSignature !== this.lastTrainSignature) {
        this.lastTrainSignature = currentSignature;
        this.render();
      }
    } catch (error) {
      // En cas d'erreur, faire un rendu quand même
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
        // Force un nouveau rendu à intervalles réguliers pour capturer les changements
        this._lastRenderTime = 0; // Reset du throttle
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
      // Utiliser l'API Home Assistant pour récupérer toutes les entités
      const allEntityRegistry = await this._hass.callWS({
        type: 'config/entity_registry/list'
      });
      
      // Filtrer les entités par device_id
      const deviceEntities = allEntityRegistry.filter(entityInfo => 
        entityInfo.device_id === this.config.device_id
      );
      
      if (!deviceEntities || deviceEntities.length === 0) {
        console.warn('⚠️ Aucune entité trouvée pour ce device_id dans le registre');
        return [];
      }
      
      // Récupérer les états des entités train trouvées avec données fraîches
      const trainEntities = deviceEntities
        .filter(entityInfo => entityInfo.entity_id.includes('train'))
        .map(entityInfo => {
          // Forcer la récupération de l'état frais
          const freshState = this._hass.states[entityInfo.entity_id];
          return freshState;
        })
        .filter(entity => entity && entity.attributes && entity.attributes.departure_time);
      
      // Filtrer les trains qui ne sont pas encore passés
      const currentTime = new Date();
      const upcomingTrains = trainEntities.filter(entity => {
        const departureTime = this.parseTime(entity.attributes.departure_time);
        return departureTime >= currentTime;
      });
      
      const sortedEntities = upcomingTrains
        .sort((a, b) => {
          const aTime = this.parseTime(a.attributes.departure_time);
          const bTime = this.parseTime(b.attributes.departure_time);
          return aTime - bTime;
        })
        .slice(0, this.config.train_lines);
      
      return sortedEntities;
      
    } catch (error) {
      console.error('❌ Erreur lors de la récupération via API:', error);
      return [];
    }
  }

  // Méthode pour parser correctement le format SNCF
  parseTime(departureTime) {
    if (!departureTime) {
      return new Date(0);
    }
    
    // Format SNCF: "19/11/2025 - 08:20"
    if (departureTime.includes('/') && departureTime.includes(' - ')) {
      const parts = departureTime.split(' - ');
      if (parts.length === 2) {
        const datePart = parts[0]; // "19/11/2025"
        const timePart = parts[1]; // "08:20"
        
        const dateComponents = datePart.split('/');
        if (dateComponents.length === 3) {
          const day = parseInt(dateComponents[0]);
          const month = parseInt(dateComponents[1]) - 1; // Mois 0-indexé
          const year = parseInt(dateComponents[2]);
          
          const timeComponents = timePart.split(':');
          if (timeComponents.length === 2) {
            const hour = parseInt(timeComponents[0]);
            const minute = parseInt(timeComponents[1]);
            
            return new Date(year, month, day, hour, minute);
          }
        }
      }
    }
    
    // Fallback vers Date classique
    return new Date(departureTime);
  }

  calculateTrainPosition(departureTime, currentTime) {
    if (!departureTime) {
      return -10;
    }
    
    const departure = this.parseTime(departureTime);
    
    if (isNaN(departure.getTime())) {
      return -10;
    }
    
    const now = currentTime || new Date();
    const diffMinutes = (departure - now) / (1000 * 60);
    
    // Train apparaît 30 minutes avant l'heure
    const maxMinutes = this.config.animation_duration;
    
    if (diffMinutes > maxMinutes) {
      return -10; // Hors de la barre
    }
    if (diffMinutes <= 0) {
      return 100; // Arrivé à la gare
    }
    
    // Position sur la barre (0% = gauche, 100% = droite)
    return ((maxMinutes - diffMinutes) / maxMinutes) * 100;
  }

  formatTime(timeString) {
    if (!timeString) {
      return 'N/A';
    }
    
    const time = this.parseTime(timeString);
    
    if (isNaN(time.getTime())) {
      return 'Format invalide';
    }
    
    const result = time.toLocaleTimeString('fr-FR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    return result;
  }

  calculateRealArrivalTime(departureTime, delayMinutes) {
    if (!departureTime || !delayMinutes || delayMinutes === 0) {
      return null;
    }
    
    const originalTime = this.parseTime(departureTime);
    const realTime = new Date(originalTime.getTime() + (delayMinutes * 60000)); // Ajouter les minutes de retard
    
    return realTime.toLocaleTimeString('fr-FR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  getTrainColor(delayMinutes, hasDelay) {
    if (!hasDelay || delayMinutes === 0) return '#4caf50'; // Vert à l'heure
    return '#f44336'; // Rouge en retard (peu importe le nombre de minutes)
  }

  async render() {
    if (!this._hass || !this.config) {
      return;
    }

    // Éviter les rendus trop fréquents (max 1 par seconde)
    const now = Date.now();
    if (now - this._lastRenderTime < 1000) {
      return;
    }
    this._lastRenderTime = now;

    const trains = await this.getTrainEntities();
    
    if (trains.length === 0) {
      this.shadowRoot.innerHTML = `
        <ha-card>
          <div class="card-content">
            <div class="error">Aucun train trouvé pour ce device. Vérifiez la configuration.</div>
          </div>
        </ha-card>
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
          overflow: hidden;
        }
        
        .train-card {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        
        .train-header {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 1.4em;
          font-weight: 600;
          color: var(--primary-color, #00539c);
          border-bottom: 2px solid var(--divider-color, #e0e0e0);
          padding-bottom: 10px;
        }
        
        .train-line {
          display: flex;
          align-items: center;
          margin-bottom: 24px;
          position: relative;
          min-height: 60px;
        }
        
        .train-track {
          position: relative;
          flex: 1;
          height: 8px;
          background: linear-gradient(90deg, #ddd 0%, #bbb 50%, #ddd 100%);
          border-radius: 4px;
          margin: 0 16px;
          overflow: visible;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
          transition: background 0.3s ease;
        }
        
        .train-track.delayed {
          background: linear-gradient(90deg, #ffcdd2 0%, #e57373 50%, #ffcdd2 100%);
          box-shadow: inset 0 2px 4px rgba(244,67,54,0.3);
        }
        
        .train-track::before {
          content: '';
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 2px;
          background: repeating-linear-gradient(
            90deg,
            #999 0px,
            #999 10px,
            transparent 10px,
            transparent 20px
          );
          transform: translateY(-50%);
          transition: background 0.3s ease;
        }
        
        .train-track.delayed::before {
          background: repeating-linear-gradient(
            90deg,
            #d32f2f 0px,
            #d32f2f 10px,
            transparent 10px,
            transparent 20px
          );
        }
        
        .train-emoji {
          position: absolute;
          top: -37px;
          transform: translateX(-50%);
          font-size: 2em;
          transition: left 0.5s ease-in-out;
          z-index: 10;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
        }
        
        .train-emoji-axial-symmetry {
          transform: translateX(-50%) scaleX(-1);
        }
        
        .station {
          display: flex;
          flex-direction: row;
          align-items: center;
          gap: 8px;
          min-width: 120px;
        }
        
        .station-emoji {
          font-size: 1.8em;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }
        
        .station-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .arrival-time {
          font-size: 1.1em;
          font-weight: 600;
          color: var(--primary-color, #00539c);
        }
        
        .arrival-time-container {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        
        .original-time {
          text-decoration: line-through;
          color: var(--secondary-text-color, #666);
          font-size: 0.9em;
        }
        
        .real-time {
          color: var(--error-color, #f44336);
          font-weight: 700;
        }
        
        .delay-info {
          font-size: 0.8em;
          font-weight: 600;
          margin-top: 2px;
        }
        
        .on-time {
          color: var(--success-color, #4caf50);
        }
        
        .delay {
          color: var(--error-color, #f44336);
        }
        
        .error {
          color: var(--error-color, #f44336);
          text-align: center;
          padding: 20px;
          font-weight: 500;
        }
      </style>
      
      <ha-card>
        <div class="train-card">
          <div class="train-header">
            <div>${this.config.title}</div>
          </div>
          
          ${trainLinesHTML}
          
        </div>
      </ha-card>
    `;
  }

  renderTrainLines(trains, currentTime) {
    return trains.map((train, index) => {
      const position = this.calculateTrainPosition(train.attributes.departure_time, currentTime);
      const delayMinutes = train.attributes.delay_minutes || 0;
      const hasDelay = train.attributes.has_delay || false;
      const trainColor = this.getTrainColor(delayMinutes, hasDelay);
      const formattedTime = this.formatTime(train.attributes.departure_time);
      const realArrivalTime = this.calculateRealArrivalTime(train.attributes.departure_time, delayMinutes);
      
      const html = `
        <div class="train-line">
          <div class="train-track ${hasDelay ? 'delayed' : ''}">
            ${position >= 0 && position <= 100 ? `
              <div class="train-emoji ${this.config.train_emoji_axial_symmetry ? "train-emoji-axial-symmetry" : ""}" 
                   style="left: ${position}%; color: ${trainColor};">
                ${this.config.train_emoji}
              </div>
            ` : `
              <!-- Train hors barre: position ${position}% -->
            `}
          </div>
          
          <div class="station">
            <div class="station-emoji">${this.config.train_station_emoji}</div>
            <div class="station-info">
              <div class="arrival-time-container">
                ${hasDelay && realArrivalTime ? `
                  <div class="arrival-time original-time">${formattedTime}</div>
                  <div class="arrival-time real-time">${realArrivalTime}</div>
                ` : `
                  <div class="arrival-time">${formattedTime}</div>
                `}
              </div>
              <div class="delay-info ${hasDelay ? 'delay' : 'on-time'}">
                ${hasDelay ? `+${delayMinutes}min` : 'À l\'heure'}
              </div>
            </div>
          </div>
        </div>
      `;
      
      return html;
    }).join('');
  }

  getCardSize() {
    return Math.max(3, this.config.train_lines + 1);
  }
}

// Définir l'élément custom
customElements.define('sncf-train-card', SncfTrainCard);