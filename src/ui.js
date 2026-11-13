import { CROPS, ITEMS, WEATHER, SEASON_EN, formatInGameTime, seasonForDay } from './data.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function weatherSvg(kind) {
  if (kind === 'rain') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 16.5h9.6a3.4 3.4 0 0 0 .3-6.8A5 5 0 0 0 7.5 10a3.3 3.3 0 0 0-.3 6.5Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><path d="m8.4 18.8-.8 1.7m4.4-1.7-.8 1.7m4.4-1.7-.8 1.7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  }
  if (kind === 'cloudy') {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9.4" cy="8.7" r="3.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 17.2h9.4a3.1 3.1 0 0 0 .2-6.2 4.6 4.6 0 0 0-8.7-.3A3 3 0 0 0 8 17.2Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.35"/><path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5m10 10 1.5 1.5m0-13-1.5 1.5m-10 10L5.5 18.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
}

function seedIcon(crop) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V10m0 4c-3.8 0-6.2-2.4-6.2-6 3.8 0 6.2 2.4 6.2 6Zm0-4c3.2 0 5.2-2 5.2-5.2-3.2 0-5.2 2-5.2 5.2Z" fill="none" stroke="${crop.leaf}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function cropDot(color) {
  return `<span class="codex-dot" style="background:${color}"></span>`;
}

export class UI {
  constructor() {
    this.game = null;
    this._money = 0;
    this._moneyRaf = null;
    this._seedOpen = false;
    this._transitionActive = false;
    this._transitionDone = null;
    this._transitionAuto = null;
    this._transitionReveal = null;
    this._muted = false;

    this.el = {
      loading: $('#loading'), loadingFill: $('#loading-fill'), loadingNote: $('#loading-note'),
      title: $('#title-screen'), btnStart: $('#btn-start'), btnContinue: $('#btn-continue'),
      hud: $('#hud'), grade: $('#grade'),
      clockDigits: $('#clock-digits'), clockProgress: $('#clock-progress'),
      seasonDay: $('#season-day'), weatherIcon: $('#weather-icon'), weatherLabel: $('#weather-label'), weatherTemp: $('#weather-temp'),
      questIndex: $('#quest-index'), questName: $('#quest-name'), questList: $('#quest-list'), questReward: $('#quest-reward'),
      money: $('#money'), energyText: $('#energy-text'), energyFill: $('#energy-fill'), waterText: $('#water-text'),
      btnAudio: $('#btn-audio'), btnHelp: $('#btn-help'), btnJournal: $('#btn-journal'),
      toasts: $('#toasts'), prompt: $('#interaction-prompt'), interactionPrompt: $('#interaction-prompt'), promptText: $('#prompt-text'), promptHint: $('#prompt-hint'),
      targetChip: $('#target-chip'), targetSwatch: $('#target-swatch'), targetName: $('#target-name'), targetStage: $('#target-stage'),
      hintBar: $('#hint-bar'), hintText: $('#hint-text'),
      hotbar: $('.hotbar'), toolSlots: $$('.tool-slot'),
      seedSlotName: $('#seed-slot-name'), seedCurrentName: $('#seed-current-name'), seedCurrentCount: $('#seed-current-count'),
      seedSwitch: $('#seed-switch'), seedPopover: $('#seed-popover'), seedOptions: $('#seed-options'),
      modalRoot: $('#modal-root'), modalCard: $('#modal-card'),
      dayTransition: $('#day-transition'), transitionKicker: $('#transition-kicker'), transitionDay: $('#transition-day'),
      transitionNote: $('#transition-note'), transitionContinue: $('#transition-continue'),
      photoBadge: $('#photo-badge'),
    };
    this.isTouch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches && (navigator.maxTouchPoints > 0);
    if (this.isTouch) {
      document.body.classList.add('touch-enabled');
      const controls = document.querySelector('.title-controls');
      if (controls) controls.innerHTML = '<span>左侧摇杆 漫步</span><span>拖动屏幕 环顾</span><span><kbd>E</kbd> 互动</span>';
    }
    this._bind();
    this.renderSeedOptions({}, 'carrot');
  }

  bindGame(game) { this.game = game; }

  _bind() {
    this.el.btnStart?.addEventListener('click', () => this.game?.startNew());
    this.el.btnContinue?.addEventListener('click', () => this.game?.continueGame());
    this.el.btnHelp?.addEventListener('click', () => this.game?.openGuide());
    this.el.btnJournal?.addEventListener('click', () => this.game?.openJournal());
    this.el.btnAudio?.addEventListener('click', () => this.game?.toggleMute());
    this.el.toolSlots.forEach((slot) => slot.addEventListener('click', () => {
      this.game?.selectTool(slot.dataset.tool);
    }));
    this.el.seedSwitch?.addEventListener('click', () => this.toggleSeedPopover());
    this.el.seedOptions?.addEventListener('click', (e) => {
      const option = e.target.closest('[data-seed]');
      if (!option) return;
      this.game?.selectSeed(option.dataset.seed);
      this.toggleSeedPopover(false);
    });
    this.el.modalRoot?.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { this.game?.closeModal(); return; }
      const buy = e.target.closest('[data-buy]');
      if (buy) { this.game?.buySeed(buy.dataset.buy); return; }
      const sell = e.target.closest('[data-sell-all]');
      if (sell) { this.game?.sellAll(); return; }
      const sleep = e.target.closest('[data-sleep]');
      if (sleep) { this.game?.sleep(); return; }
      const tab = e.target.closest('[data-journal-tab]');
      if (tab) { this.game?.openJournal(tab.dataset.journalTab); return; }
      const action = e.target.closest('[data-action]');
      if (!action) return;
      if (action.dataset.action === 'close') this.game?.closeModal();
      if (action.dataset.action === 'journal') this.game?.openJournal();
      if (action.dataset.action === 'help') this.game?.openGuide();
    });
    this.el.transitionContinue?.addEventListener('click', () => this.finishDayTransition());
    document.addEventListener('pointerdown', (e) => {
      if (!this._seedOpen) return;
      if (e.target.closest('#seed-popover') || e.target.closest('#seed-switch')) return;
      this.toggleSeedPopover(false);
    });
  }

  /* ---------------- loading & title ---------------- */
  setLoading(progress, note) {
    if (this.el.loadingFill) this.el.loadingFill.style.width = `${Math.round(progress * 100)}%`;
    if (note && this.el.loadingNote) this.el.loadingNote.textContent = note;
  }

  hideLoading() {
    this.el.loading.classList.add('hidden');
    setTimeout(() => { this.el.loading.style.display = 'none'; }, 1100);
  }

  showTitle(hasSave) {
    this.el.title.classList.remove('hidden');
    this.el.btnContinue.classList.toggle('is-hidden', !hasSave);
    this.el.hud.classList.add('hidden');
  }

  hideTitle() {
    this.el.title.classList.add('hidden');
    setTimeout(() => { this.el.title.style.display = 'none'; }, 1500);
  }

  showHud() {
    this.el.hud.classList.remove('hidden');
  }

  /* ---------------- HUD ---------------- */
  setHudState(state) {
    const season = seasonForDay(state.day);
    this.el.seasonDay.textContent = `${season} · 第 ${state.day} 日`;
    this.el.clockDigits.textContent = formatInGameTime(state.time);
    const dayProgress = clamp((state.time - 360) / (18 * 60), 0, 1);
    this.el.clockProgress.style.strokeDashoffset = `${195 * (1 - dayProgress)}`;
    this.setWeather(state.weather);
  }

  setWeather(weather) {
    const w = WEATHER[weather] || WEATHER.sunny;
    this.el.weatherIcon.innerHTML = weatherSvg(w.id);
    this.el.weatherLabel.textContent = w.name;
    this.el.weatherTemp.textContent = `${w.temp}°`;
  }

  setMoney(value) {
    const target = Math.max(0, Math.round(value));
    const start = this._money;
    if (start === target) { this.el.money.textContent = target; return; }
    if (this._moneyRaf) cancelAnimationFrame(this._moneyRaf);
    const t0 = performance.now();
    const step = (now) => {
      const p = clamp((now - t0) / 500, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      this.el.money.textContent = Math.round(start + (target - start) * eased);
      if (p < 1) this._moneyRaf = requestAnimationFrame(step);
      else { this._money = target; this._moneyRaf = null; }
    };
    this._money = target;
    this.el.money.classList.remove('bump');
    void this.el.money.offsetWidth;
    this.el.money.classList.add('bump');
    this._moneyRaf = requestAnimationFrame(step);
  }

  setEnergy(value, max) {
    const p = clamp(value / max, 0, 1);
    this.el.energyFill.style.width = `${p * 100}%`;
    this.el.energyFill.classList.toggle('low', p < 0.28);
    this.el.energyText.textContent = `${Math.ceil(value)} / ${max}`;
  }

  setWater(value, max) {
    this.el.waterText.textContent = `${value} / ${max}`;
  }

  setTool(tool) {
    this.el.toolSlots.forEach((s) => s.classList.toggle('active', s.dataset.tool === tool));
  }

  setSeed(type, count) {
    const crop = CROPS[type];
    if (!crop) return;
    this.el.seedCurrentName.textContent = crop.name;
    this.el.seedCurrentCount.textContent = `×${count}`;
    this.el.seedSlotName.textContent = crop.name;
    this.el.seedOptions.querySelectorAll('[data-seed]').forEach((el) => {
      el.classList.toggle('active', el.dataset.seed === type);
    });
  }

  renderSeedOptions(seeds, selected) {
    const list = Object.values(CROPS).map((crop) => {
      const n = seeds[crop.id] || 0;
      return `<button class="seed-option ${crop.id === selected ? 'active' : ''}" data-seed="${crop.id}">
        <span class="seed-dot" style="background:${crop.color}"></span>
        <b>${crop.name}</b><small>${crop.days} 天成熟</small><em>×${n}</em>
      </button>`;
    }).join('');
    this.el.seedOptions.innerHTML = list;
  }

  toggleSeedPopover(force) {
    this._seedOpen = force === undefined ? !this._seedOpen : force;
    this.el.seedPopover.classList.toggle('hidden', !this._seedOpen);
  }

  closeSeedPopover() { this.toggleSeedPopover(false); }

  renderQuest(view) {
    this.el.questIndex.textContent = String(view.index).padStart(2, '0');
    this.el.questName.textContent = view.name;
    this.el.questReward.textContent = `+${view.reward} G`;
    this.el.questList.innerHTML = view.objectives.map((o) => (
      `<li class="${o.done ? 'done' : ''}"><span class="task-box"></span>${o.text}</li>`
    )).join('');
  }

  setHint(text) {
    this.el.hintText.textContent = text;
  }

  showPrompt(text, hint = '') {
    this.el.promptText.textContent = text;
    this.el.promptHint.textContent = hint;
    this.el.promptHint.style.display = hint ? '' : 'none';
    this.el.prompt.classList.remove('hidden');
    this.el.hintBar.classList.add('hidden');
  }

  hidePrompt() {
    this.el.prompt.classList.add('hidden');
    this.el.hintBar.classList.remove('hidden');
  }

  showTarget(data) {
    this.el.targetSwatch.style.background = data.color || '#d9b97d';
    this.el.targetSwatch.style.boxShadow = `0 0 10px ${data.color || '#d9b97d'}66`;
    this.el.targetName.textContent = data.name;
    this.el.targetStage.textContent = data.stageText;
    this.el.targetChip.classList.remove('hidden');
  }

  hideTarget() { this.el.targetChip.classList.add('hidden'); }

  toast(message, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    this.el.toasts.appendChild(el);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    }, 3000);
  }

  setMuted(muted) {
    this._muted = muted;
    this.el.btnAudio.classList.toggle('muted', muted);
    this.el.btnAudio.setAttribute('aria-label', muted ? '开启声音' : '关闭声音');
    this.el.btnAudio.title = muted ? '开启声音 (M)' : '关闭声音 (M)';
  }

  togglePhotoMode() {
    const on = !this.el.hud.classList.contains('photo-mode');
    this.el.hud.classList.toggle('photo-mode', on);
    this.el.grade.classList.toggle('photo-mode', on);
    this.el.photoBadge.classList.toggle('hidden', !on);
    return on;
  }

  /* ---------------- modals ---------------- */
  openModal(html, variant = '') {
    this.el.modalCard.className = `modal-card ${variant}`;
    this.el.modalCard.innerHTML = html;
    this.el.modalCard.scrollTop = 0;
    this.el.modalRoot.classList.remove('hidden');
  }

  closeModal() {
    this.el.modalRoot.classList.add('hidden');
    this.el.modalCard.innerHTML = '';
  }

  isModalOpen() { return !this.el.modalRoot.classList.contains('hidden'); }

  openShop(state) {
    const cards = Object.values(CROPS).map((crop) => {
      const owned = state.seeds[crop.id] || 0;
      const affordable = state.money >= crop.seedPrice;
      return `<button class="seed-card" data-buy="${crop.id}" ${affordable ? '' : 'disabled'}>
        <span class="seed-swatch" style="background:${crop.color}1c;border:1px solid ${crop.color}44">${seedIcon(crop)}</span>
        <span class="seed-card-copy"><strong>${crop.name}种子</strong><small>${crop.days} 天成熟 · 收获售价 ${crop.sell} G · 已有 ${owned}</small></span>
        <span class="price">${crop.seedPrice}<i> G</i></span>
      </button>`;
    }).join('');
    const html = `
      <div class="modal-head">
        <span class="modal-kicker">GRAIN &amp; GOODS · 谷雨杂货铺</span>
        <h2>挑一些种子</h2>
        <p class="modal-desc">木架上摆着新到的种子袋，空气里有咖啡和干草的味道。<br>“种子要挑饱满的，像挑一个晴天。”谷雨说。</p>
        <button class="modal-close" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-rule"></div>
      <div class="modal-grid">${cards}</div>
      <div class="modal-footer">
        <span class="modal-balance">口袋里的金币 <strong>${state.money} G</strong></span>
        <button class="paper-btn" data-close>先随便看看</button>
      </div>
      <p class="quiet-note">买下的种子会放进你的背包。走到田里，按 3 选择种子，再按 E 播种。</p>`;
    this.openModal(html, 'shop-modal');
  }

  openSell(state) {
    const rows = [];
    let total = 0;
    for (const [key, count] of Object.entries(state.produce || {})) {
      if (!count) continue;
      const item = CROPS[key] || ITEMS[key];
      if (!item) continue;
      const subtotal = item.sell * count;
      total += subtotal;
      rows.push(`<div class="sell-row">
        <span class="sell-name">${cropDot(item.color)}${item.name}</span>
        <span class="qty">× ${count}</span>
        <span class="line-total">${subtotal}<i>G</i></span>
      </div>`);
    }
    const body = rows.length ? `<div class="sell-list">${rows}</div>
      <div class="sell-total"><span>本次出货合计</span><strong>${total} G</strong></div>`
      : `<div class="empty-state"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M8 15h24v17H8V15Zm4-6h16l4 6H8l4-6Zm6 6v17m4-17v17" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>背包里还没有可以出货的收成。<br>去田里收获一些作物吧。</div>`;
    const html = `
      <div class="modal-head">
        <span class="modal-kicker">THE SHIPPING BIN</span>
        <h2>今天的收成</h2>
        <p class="modal-desc">把作物放进木箱，明天一早镇上的小货车会来把它们带走。<br>现金会直接记在你的账上。</p>
        <button class="modal-close" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-rule"></div>
      ${body}
      <div class="modal-footer">
        <span class="modal-balance">出货后金币 <strong>${state.money + total} G</strong></span>
        <div style="display:flex;gap:8px">
          <button class="paper-btn" data-close>关上箱子</button>
          <button class="paper-btn solid" data-sell-all ${total ? '' : 'disabled'}>全部出货 · ${total} G</button>
        </div>
      </div>`;
    this.openModal(html, 'sell-modal');
  }

  openRest(state) {
    const tomorrow = WEATHER[state.tomorrowWeather] || WEATHER.sunny;
    const html = `
      <div class="rest-banner"></div>
      <div class="modal-head">
        <span class="modal-kicker">THE FARMHOUSE · 木屋</span>
        <h2>今天到这里吧</h2>
        <p class="modal-desc">炉膛里的火还亮着。窗外有虫鸣，远处的水面托着一小片月光。<br>好好睡一觉，明天土地会记得你今天的照料。</p>
        <button class="modal-close" data-close aria-label="关闭">×</button>
      </div>
      <div class="rest-summary">
        <div class="rest-stat"><span>明天</span><strong>第 ${state.nextDay} 日 · ${state.nextSeason}</strong></div>
        <div class="rest-stat"><span>已经浇水</span><strong>${state.wateredCount} 块田</strong></div>
        <div class="rest-stat"><span>即将成熟</span><strong>${state.growingCount} 株作物</strong></div>
      </div>
      <div class="forecast-row">
        <span class="weather-icon">${weatherSvg(tomorrow.id)}</span>
        <span>明日天气</span><strong>${tomorrow.name}</strong>
        <span>${tomorrow.note}</span>
      </div>
      <div class="modal-footer">
        <span class="modal-balance">体力会在清晨恢复 · 自动存档</span>
        <button class="paper-btn solid" data-sleep>睡到明天</button>
      </div>`;
    this.openModal(html, 'rest-modal');
  }

  openLetter() {
    const html = `
      <div class="modal-head">
        <span class="modal-kicker">A LETTER FROM THE VALLEY</span>
        <h2>给新来的农庄主</h2>
        <button class="modal-close" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-rule"></div>
      <div class="letter-body">
        <p>你好呀，</p>
        <p>欢迎回到雾谷农庄。我是谷雨，住在东边小路尽头的杂货铺里。你外祖父留下的这片山谷，终于又亮起灯了。</p>
        <p>木屋的炉子我提前生好了，井水很甜，田里还有几株没来得及收的作物。别急着把一切都安排好——先去看看风，认识一下阿麦，再决定第一颗种子种在哪里。</p>
        <p>缺什么就来铺子里找我。种田这件事，急不来的。</p>
        <div class="letter-sign">—— 谷雨</div>
        <div class="letter-gift">信里夹着 80 G，是给新农庄主的见面礼。</div>
      </div>
      <div class="modal-footer">
        <span class="modal-balance">已读信件</span>
        <button class="paper-btn solid" data-close>把信收好</button>
      </div>`;
    this.openModal(html, 'letter');
  }

  openGuide() {
    const html = `
      <div class="modal-head">
        <span class="modal-kicker">A SMALL FIELD GUIDE</span>
        <h2>农庄指南</h2>
        <p class="modal-desc">不用赶时间。这里只有四季、天气，和一块慢慢变好的土地。</p>
        <button class="modal-close" data-close aria-label="关闭">×</button>
      </div>
      <div class="modal-rule"></div>
      <div class="guide-grid">
        <div>
          <div class="key-row"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>在山谷里走动</span></div>
          <div class="key-row"><span class="mouse-icon" style="border-color:rgba(30,37,29,.35)"></span><span>按住拖动，环顾四周</span></div>
          <div class="key-row"><kbd>Shift</kbd><span>小跑</span></div>
          <div class="key-row"><kbd>E</kbd><span>使用农具 / 与人和物互动</span></div>
          <div class="key-row"><kbd>鼠标滚轮</kbd><span>拉近或拉远镜头</span></div>
        </div>
        <div>
          <div class="key-row"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>锄头 / 水壶 / 种子 / 收获</span></div>
          <div class="key-row"><kbd>Q</kbd><span>切换当前种子</span></div>
          <div class="key-row"><kbd>B</kbd><span>背包与作物图鉴</span></div>
          <div class="key-row"><kbd>H</kbd><span>拍照模式（隐藏界面）</span></div>
          <div class="key-row"><kbd>Esc</kbd><span>关闭当前面板</span></div>
        </div>
      </div>
      <div class="guide-grid" style="margin-top:12px">
        <div class="guide-block"><span>一天的开始</span><p>走到木屋门口按 E 回屋休息。浇水后的作物会在你睡着时长大一截。雨天会替你浇灌整片菜圃。</p></div>
        <div class="guide-block"><span>泥土与种子</span><p>先用锄头把地翻松，再按 3 选种子、按 E 播种。水壶里的水可以去井边或池塘边打满。</p></div>
        <div class="guide-block"><span>收成与金币</span><p>成熟的作物会微微发亮。走到田边按 E 收获，再拿到木屋旁的出货箱换成金币。</p></div>
        <div class="guide-block"><span>慢一点也没关系</span><p>这里没有失败结局。没浇水的作物只会多等几天，天气不好就回屋听听雨。</p></div>
      </div>
      <div class="modal-footer">
        <span class="modal-balance">雾谷农庄 · 一本没有页码的手记</span>
        <button class="paper-btn" data-close>继续生活</button>
      </div>`;
    this.openModal(html, 'guide-modal');
  }

  openJournal(state, tab = 'backpack') {
    const tabs = `<div class="journal-tabs">
      <button class="journal-tab ${tab === 'backpack' ? 'active' : ''}" data-journal-tab="backpack">背包</button>
      <button class="journal-tab ${tab === 'codex' ? 'active' : ''}" data-journal-tab="codex">作物图鉴</button>
    </div>`;
    let body = '';
    if (tab === 'backpack') {
      const seeds = Object.values(CROPS).map((crop) => (
        `<div class="inv-item"><span>${crop.name}种子</span><strong>×${state.seeds[crop.id] || 0}</strong><small>${crop.seedPrice} G / 包</small></div>`
      )).join('');
      const produceKeys = Object.keys(state.produce || {}).filter((k) => state.produce[k] > 0);
      const produce = produceKeys.length
        ? produceKeys.map((k) => {
          const item = CROPS[k] || ITEMS[k];
          return `<div class="inv-item"><span>${item.name}</span><strong>×${state.produce[k]}</strong><small>${item.sell} G / 个</small></div>`;
        }).join('')
        : `<div class="inv-item" style="grid-column:span 4"><span>收成</span><strong>还没有</strong><small>成熟的作物在等你</small></div>`;
      body = `<div style="margin-top:17px;font-size:8px;letter-spacing:.15em;color:rgba(39,47,34,.4)">种子袋</div>
        <div class="inv-grid">${seeds}</div>
        <div style="margin-top:18px;font-size:8px;letter-spacing:.15em;color:rgba(39,47,34,.4)">收获物</div>
        <div class="inv-grid">${produce}</div>
        <p class="quiet-note">洒水壶容量 ${state.water}/${state.waterMax}。可以在井边或池塘的码头补满。</p>`;
    } else {
      body = `<div class="crop-codex">${Object.values(CROPS).map((crop) => (
        `<div class="codex-row">${cropDot(crop.color)}<b>${crop.name}</b><small>${crop.days} 天成熟 · 卖 ${crop.sell} G</small></div>`
      )).join('')}</div>
      <p class="quiet-note">每一种作物需要 3 个浇过水的夜晚长大。成熟后，走到田边按 E 收获。</p>`;
    }
    const html = `
      <div class="modal-head">
        <span class="modal-kicker">THE FARMER'S NOTEBOOK</span>
        <h2>农庄手记</h2>
        <p class="modal-desc">一页记种子，一页记天气，剩下的留给偶尔路过的人。</p>
        <button class="modal-close" data-close aria-label="关闭">×</button>
      </div>
      ${tabs}
      ${body}
      <div class="modal-footer">
        <span class="modal-balance">金币 <strong>${state.money} G</strong></span>
        <button class="paper-btn" data-close>合上手记</button>
      </div>`;
    this.openModal(html, 'journal-modal');
  }

  /* ---------------- day transition ---------------- */
  playDayTransition(data, done) {
    this._transitionActive = true;
    this._transitionDone = done;
    clearTimeout(this._transitionAuto);
    clearTimeout(this._transitionReveal);
    this.el.transitionKicker.textContent = data.kicker;
    this.el.transitionDay.textContent = data.title;
    this.el.transitionNote.innerHTML = data.note;
    this.el.transitionContinue.classList.add('hidden');
    this.el.dayTransition.classList.remove('hidden', 'is-leaving');
    this._transitionReveal = setTimeout(() => this.el.transitionContinue.classList.remove('hidden'), 1100);
    this._transitionAuto = setTimeout(() => this.finishDayTransition(), 4600);
  }

  isTransitioning() { return this._transitionActive; }

  finishDayTransition() {
    if (!this._transitionActive) return;
    this._transitionActive = false;
    clearTimeout(this._transitionAuto);
    clearTimeout(this._transitionReveal);
    this.el.dayTransition.classList.add('is-leaving');
    const done = this._transitionDone;
    this._transitionDone = null;
    setTimeout(() => {
      this.el.dayTransition.classList.add('hidden');
      done?.();
    }, 1100);
  }
}
