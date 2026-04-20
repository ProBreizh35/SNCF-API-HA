// Ajouter au registre des cartes personnalisées
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'sncf-train-card',
  name: 'SNCF Train Card',
  preview: true,
  description: 'V3.3 - Radar de ligne avec badges textuels et alertes Orange/Rouge.'
});

// --- CLASSE DE L'ÉDITEUR VISUEL ---
class SncfTrainCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); }
  setConfig(config) { this._config = { ...config }; this.render(); }
  render() {
    if (!this._config) return;
    this.shadowRoot.innerHTML = `
      <div class="card-config">
        <div class="field"><label>Titre de la carte</label><input type="text" id="title" value="${this._config.title || 'Trains SNCF'}"></div>
        <div class="field"><label>Device ID (Requis)</label><input type="text" id="device_id" value="${this._config.device_id || ''}"></div>
        <div class="field-row">
          <div class="field"><label>Nombre de trains</label><input type="number" id="train_lines" min="1" max="10" value="${this._config.train_lines !== undefined ? this._config.train_lines : 3}"></div>
          <div class="field"><label>Fenêtre animation (min)</label><input type="number" id="animation_duration" value="${this._config.animation_duration || 30}"></div>
        </div>
        <div class="field-row">
          <div class="field checkbox highlight"><input type="checkbox" id="use_real_duration" ${this._config.use_real_duration ? 'checked' : ''}><label>Vitesse réelle</label></div>
          <div class="field" style="${this._config.use_real_duration ? '' : 'opacity:0.5; pointer-events:none;'}"><label>Facteur vitesse</label><input type="number" id="speed_factor" step="0.1" value="${this._config.speed_factor || 2}"></div>
        </div>
        <div class="field checkbox highlight"><input type="checkbox" id="show_route_details" ${this._config.show_route_details ? 'checked' : ''}><label>Afficher le radar de ligne</label></div>
      </div>
      <style>
        .card-config { display: flex; flex-direction: column; gap: 16px; font-family: sans-serif; }
        .field { display: flex; flex-direction: column; flex: 1; }
        .field-row { display: flex; gap: 16px; align-items: flex-end; }
        label { margin-bottom: 4px; color: var(--secondary-text-color); font-size: 12px; font-weight: 500; }
        input { padding: 8px; border: 1px solid var(--divider-color); border-radius: 4px; background: var(--card-background-color); color: var(--primary-text-color); }
        .checkbox { flex-direction: row; align-items: center; gap: 8px; }
        .checkbox input { width: 16px; height: 16px; margin: 0; }
        .highlight { background: rgba(0, 83, 156, 0.05); padding: 8px; border-radius: 4px; border-left: 3px solid #00539c; }
      </style>`;
    this.shadowRoot.querySelectorAll('input').forEach(input => {
      input.addEventListener('change', this.valueChanged.bind(this));
    });
  }
  valueChanged(ev) {
    const target = ev.target;
    let value = target.type === 'checkbox' ? target.checked : (target.type === 'number' ? Number(target.value) : target.value);
    this._config = { ...this._config, [target.id]: value };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config }, bubbles: true, composed: true }));
  }
}
customElements.define('sncf-train-card-editor', SncfTrainCardEditor);

// --- CLASSE DE LA CARTE PRINCIPALE ---
class SncfTrainCard extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: 'open' }); }
  static getConfigElement() { return document.createElement("sncf-train-card-editor"); }
  setConfig(config) { this.config = { title: "Trains SNCF", train_emoji: "🚅", train_station_emoji: "🚉", animation_duration: 30, use_real_duration: true, speed_factor: 2, ...config }; }
  set hass(hass) { this._hass = hass; this.render(); }

  async getTrainEntities() {
    if (!this._hass || !this.config.device_id) return [];
    try {
      const allReg = await this._hass.callWS({ type: 'config/entity_registry/list' });
      const deviceEntities = allReg.filter(e => e.device_id === this.config.device_id);
      const trainEntities = deviceEntities.filter(e => e.entity_id.includes('train'))
        .map(e => this._hass.states[e.entity_id]).filter(e => e && e.attributes && e.attributes.departure_time);
      const now = new Date();
      return trainEntities.filter(e => this.parseTime(e.attributes.departure_time) >= now)
        .sort((a, b) => this.parseTime(a.attributes.departure_time) - this.parseTime(b.attributes.departure_time))
        .slice(0, this.config.train_lines || 3);
    } catch (e) { return []; }
  }

  parseTime(t) {
    if (!t || !t.includes(' - ')) return new Date(t || 0);
    const p = t.split(' - '), d = p[0].split('/'), h = p[1].split(':');
    return new Date(d[2], d[1]-1, d[0], h[0], h[1]);
  }

  render() {
    if (!this._hass || !this.config) return;
    this.getTrainEntities().then(trains => {
      const currentTime = new Date();
      const trainLinesHTML = trains.map(train => {
        const attrs = train.attributes;
        const dep = this.parseTime(attrs.departure_time);
        const diff = (dep - currentTime) / 60000;
        const max = this.config.animation_duration || 30;
        const pos = diff > max ? -10 : (diff <= 0 ? 100 : ((max - diff) / max) * 100);
        const hasDelay = attrs.has_delay || false;
        const isCanceled = attrs.canceled || false;
        
        let animDur = this.config.use_real_duration && attrs.duration_minutes ? 
                      attrs.duration_minutes * (this.config.speed_factor || 2) : this.config.animation_duration;

        let timelineHTML = '';
        if (this.config.show_route_details && attrs.stops_schedule) {
          timelineHTML = `<div class="timeline-wrapper"><div class="timeline-line ${hasDelay?'delayed-line':''}"></div><div class="timeline-container">` + 
            attrs.stops_schedule.map(s => {
              let statusBadge = "";
              if (s.effect === 'deleted') statusBadge = ' <span class="badge-stop deleted">SUPPRIMÉ</span>';
              else if (s.effect === 'added') statusBadge = ' <span class="badge-stop added">RAJOUTÉ</span>';

              return `
                <div class="timeline-stop">
                  <div class="timeline-dot ${s.effect==='deleted'?'deleted-dot':(s.effect==='added'?'added-dot':(hasDelay?'delayed-dot':''))}"></div>
                  <div class="timeline-time">${s.time}</div>
                  <div class="timeline-name" style="${s.effect==='deleted'?'text-decoration:line-through;opacity:0.5':''}">
                    ${s.name}${statusBadge}
                  </div>
                </div>`;
            }).join('') + `</div></div>`;
        }

        const timeOnly = (t) => t ? t.split(' - ')[1] : "--:--";

        return `
          <div class="train-line-container" style="${isCanceled ? 'opacity: 0.8;' : ''}">
            <div class="train-line">
              <div class="train-track ${(hasDelay || isCanceled) ? 'delayed' : ''}">
                <div class="train-emoji ${this.config.train_emoji_axial_symmetry?'train-emoji-axial-symmetry':''}" 
                     style="left:${pos}%; animation: moveTrain ${animDur}s linear infinite; ${isCanceled ? 'top: -30px;' : ''}">
                  ${isCanceled ? '❌' : this.config.train_emoji}
                </div>
              </div>
              <div class="station">
                <div class="station-emoji">${this.config.train_station_emoji}</div>
                <div class="station-info">
                  <div class="arrival-time">${hasDelay ? `<span class="original-time">${timeOnly(attrs.base_departure_time)}</span><span class="real-time-delay">${timeOnly(attrs.departure_time)}</span>` : timeOnly(attrs.departure_time)}</div>
                  <div class="delay-info ${isCanceled ? 'canceled-text' : (hasDelay ? 'delay-orange' : 'on-time')}">
                    ${isCanceled ? 'ANNULÉ' : (hasDelay ? `+${attrs.delay_minutes}min` : 'À l\'heure')}
                  </div>
                  ${attrs.delay_cause ? `<div class="delay-cause">${attrs.delay_cause}</div>` : ''}
                </div>
              </div>
            </div>
            ${timelineHTML}
          </div>`;
      }).join('');

      this.shadowRoot.innerHTML = `
        <style>
          ha-card { padding: 16px; background: var(--card-background-color, #fff); border-radius: 12px; }
          .train-header { font-size: 1.4em; font-weight: 600; color: var(--primary-color, #00539c); border-bottom: 2px solid var(--divider-color); padding-bottom: 10px; margin-bottom: 20px; }
          .train-line-container { margin-bottom: 25px; }
          .train-line { display: flex; align-items: center; position: relative; height: 60px; }
          .train-track { position: relative; flex: 1; height: 8px; background: linear-gradient(90deg, #ddd 0%, #bbb 50%, #ddd 100%); border-radius: 4px; margin: 0 16px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.1); }
          .train-track.delayed { background: linear-gradient(90deg, #ffcdd2 0%, #e57373 50%, #ffcdd2 100%); }
          .train-track::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 2px; background: repeating-linear-gradient(90deg, #999 0px, #999 10px, transparent 10px, transparent 20px); transform: translateY(-50%); }
          .train-track.delayed::before { background: repeating-linear-gradient(90deg, #d32f2f 0px, #d32f2f 10px, transparent 10px, transparent 20px); }
          .train-emoji { position: absolute; top: -37px; font-size: 2em; transform: translateX(-50%); z-index: 10; display: flex; align-items: center; justify-content: center; line-height: 1; }
          .train-emoji-axial-symmetry { transform: translateX(-50%) scaleX(-1); }
          @keyframes moveTrain { 0%, 100% { margin-top: 0; } 50% { margin-top: 2px; } }
          .station { display: flex; align-items: center; gap: 8px; min-width: 135px; justify-content: flex-end; }
          .station-emoji { font-size: 1.8em; }
          .arrival-time { font-size: 1.1em; font-weight: 600; color: var(--primary-color, #00539c); }
          .original-time { text-decoration: line-through; color: var(--secondary-text-color); font-size: 0.85em; margin-right: 4px; }
          .real-time-delay { color: #ff9800; font-weight: 700; }
          .delay-orange { color: #ff9800; font-weight: 600; font-size: 0.9em; }
          .on-time { color: #4caf50; font-weight: 600; font-size: 0.9em; }
          .canceled-text { color: #f44336 !important; font-weight: bold; font-size: 0.9em; }
          .delay-cause { font-size: 0.7em; font-style: italic; opacity: 0.8; color: var(--secondary-text-color); }
          
          /* STYLES RADAR & BADGES */
          .timeline-wrapper { position: relative; margin-top: 10px; padding: 0 10px; }
          .timeline-line { position: absolute; top: 6px; left: 30px; right: 30px; height: 2px; background: #00539c; opacity: 0.2; z-index: 1; }
          .timeline-line.delayed-line { background: #ff9800; opacity: 0.5; }
          .timeline-container { display: flex; justify-content: space-between; position: relative; z-index: 2; }
          .timeline-stop { display: flex; flex-direction: column; align-items: center; width: 80px; }
          .timeline-dot { width: 14px; height: 14px; border-radius: 50%; background: var(--card-background-color); border: 3px solid #00539c; margin-bottom: 6px; box-sizing: border-box; }
          .timeline-dot.delayed-dot { border-color: #ff9800; }
          .timeline-dot.deleted-dot { background: #f44336; border-color: #f44336; }
          .timeline-dot.added-dot { border-color: #ff9800; border-style: dashed; }
          .timeline-time { font-size: 0.75em; font-weight: bold; }
          .timeline-name { font-size: 0.65em; text-align: center; color: var(--secondary-text-color); line-height: 1.2; position: relative; }
          .badge-stop { font-size: 0.85em; font-weight: bold; padding: 1px 4px; border-radius: 3px; margin-left: 2px; display: inline-block; }
          .badge-stop.deleted { background-color: #f44336; color: white; }
          .badge-stop.added { background-color: #ff9800; color: white; }
        </style>
        <ha-card><div class="train-header">${this.config.title}</div>${trainLinesHTML}</ha-card>`;
    });
  }
}
customElements.define('sncf-train-card', SncfTrainCard);