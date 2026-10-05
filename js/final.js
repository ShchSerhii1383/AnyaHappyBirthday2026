/* ==========================================================================
   ФІНАЛ — animation engine
   --------------------------------------------------------------------------
   Контент і таймінги живуть у js/config.js. Тут — лише механіка:

     1. Основа: посилання на DOM, стан, дрібні помічники
     2. Сцена: масштабування і побудова елементів із конфігу
     3. Preload: зображення, шрифти, відео, музика
     4. Годинник: єдине джерело часу (музика, а без неї — таймер)
     5. Частинки: іскри на одному canvas
     6. Дії сцен: що саме відбувається в кожен момент
     7. Timeline: перетворення конфігу на список cues
     8. Sequencer: один цикл, який запускає cues вчасно
     9. Старт, debug, прибирання

   Головний принцип: кожна дія отримує `late` — на скільки секунд вона
   запізнилася. Анімація тоді стартує одразу з потрібного місця. Завдяки
   цьому працюють і старт із середини (?t=62), і повернення з фонової вкладки.
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------ 1. Основа */

  const CFG = window.FINAL_CONFIG;
  if (!CFG) {
    console.error('[final] Не знайдено FINAL_CONFIG — перевірте js/config.js');
    return;
  }

  const T = CFG.timing;
  const L = CFG.layout;

  const query = new URLSearchParams(window.location.search);
  const DEBUG = Boolean(CFG.debug) || query.get('debug') === '1';
  const START_OFFSET = Math.max(0, parseFloat(query.get('t')) || 0);

  const EASE_OUT = 'cubic-bezier(0.22, 0.7, 0.2, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.6, 0, 0.2, 1)';

  /* Запасні значення, якщо метадані відео чи фото не прочитались. */
  const FALLBACK_VIDEO_DURATION = 10;
  const FALLBACK_PORTRAIT_ASPECT = 764 / 1120;

  const byId = (id) => document.getElementById(id);

  const dom = {
    stage: byId('stage'),
    sky: byId('sky'),
    skyDim: byId('skyDim'),
    giftLight: byId('giftLight'),
    giftLevel: byId('giftLevel'),
    giftPulse: byId('giftPulse'),
    giftBeam: byId('giftBeam'),
    warmVeil: byId('warmVeil'),
    portrait: byId('portrait'),
    video: byId('thenNowVideo'),
    childhoodPhoto: byId('childhoodPhoto'),
    modernPhoto: byId('modernPhoto'),
    memories: byId('memories'),
    stars: byId('stars'),
    wishes: byId('wishes'),
    phraseChildhood: byId('phraseChildhood'),
    phrasePresent: byId('phrasePresent'),
    greetingVeil: byId('greetingVeil'),
    greeting: byId('greeting'),
    birthday: byId('birthday'),
    birthdayTitle: byId('birthdayTitle'),
    birthdayLine: byId('birthdayLine'),
    birthdayName: byId('birthdayName'),
    birthdayHeart: byId('birthdayHeart'),
    heartThread: byId('heartThread'),
    heartPath: byId('heartPath'),
    heartShimmer: byId('heartShimmer'),
    heartSpark: byId('heartSpark'),
    heartSparkBody: byId('heartSparkBody'),
    blackout: byId('blackout'),
    start: byId('start'),
    startStar: byId('startStar'),
    startLabel: byId('startLabel'),
    music: byId('music'),
    debug: byId('debug')
  };

  /* Елементи, створені з конфігу (заповнюються у buildScene). */
  const memoryItems = [];   // { el, cfg }
  const wishItems = [];     // { el, inner, star, starBody, cfg }
  const greetingBlocks = [];   // { el, cfg }

  const state = {
    ready: false,           // assets завантажені, можна стартувати
    started: false,         // захист від подвійного запуску
    paused: false,          // лише для debug
    finished: false,        // екран уже чорний, малювати більше нічого
    modernShown: false,     // підміна відео → фото вже відбулася
    act: 'очікування',
    videoOk: false,
    audioOk: false
  };

  const warnings = [];

  function warn(message, error) {
    console.warn('[final] ' + message, error || '');
    warnings.push(message);
  }

  /** transform, що ставить ЦЕНТР елемента у точку (x, y) сцени. */
  function placeAt(x, y, extra) {
    return 'translate(' + x + 'px, ' + y + 'px) translate(-50%, -50%) ' + (extra || '');
  }

  /**
   * Запускає анімацію Web Animations API і залишає елемент у кінцевому стані.
   * options: { duration, delay, easing, late } — усе в секундах;
   * для нескінченних анімацій ще { iterations: Infinity, direction: 'alternate' }.
   */
  function animate(el, keyframes, options) {
    if (!el) return null;
    const o = options || {};
    try {
      return el.animate(keyframes, {
        duration: Math.max(1, (o.duration || 0) * 1000),
        delay: ((o.delay || 0) - (o.late || 0)) * 1000,
        easing: o.easing || 'ease',
        iterations: o.iterations || 1,
        direction: o.direction || 'normal',
        fill: 'both'
      });
    } catch (error) {
      warn('Анімація не запустилась', error);
      return null;
    }
  }

  function waitSeconds(seconds) {
    return new Promise(function (resolve) { window.setTimeout(resolve, seconds * 1000); });
  }

  /* ------------------------------------------------------------- 2. Сцена */

  function fitStage() {
    const scale = Math.min(
      window.innerWidth / CFG.stage.width,
      window.innerHeight / CFG.stage.height
    );
    dom.stage.style.setProperty('--stage-scale', String(scale));
  }

  function createStar(colorKey) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.setProperty('--c', CFG.starColors[colorKey] || CFG.starColors.gold);
    star.innerHTML =
      '<div class="star__body"><div class="star__twinkle">' +
      '<i class="star__halo"></i>' +
      '<i class="star__spike star__spike--v"></i>' +
      '<i class="star__spike star__spike--h"></i>' +
      '<i class="star__core"></i>' +
      '</div></div>';
    return star;
  }

  function buildMemories() {
    CFG.memories.forEach(function (cfg, index) {
      const el = document.createElement('div');
      el.className = 'memory';
      el.style.height = cfg.centerHeight + 'px';

      const img = document.createElement('img');
      img.className = 'memory__img';
      img.alt = '';
      img.style.setProperty('--float-delay', (-index * 1.3) + 's');

      el.appendChild(img);
      dom.memories.appendChild(el);
      memoryItems.push({ el: el, img: img, cfg: cfg });
    });
  }

  function buildWishes() {
    CFG.wishes.forEach(function (cfg, index) {
      const color = CFG.starColors[cfg.color] || CFG.starColors.gold;

      const star = createStar(cfg.color);
      star.style.left = cfg.star.x + 'px';
      star.style.top = cfg.star.y + 'px';
      star.style.setProperty('--twinkle', (2.8 + (index % 4) * 0.5) + 's');
      star.style.setProperty('--twinkle-delay', (-index * 0.7) + 's');
      dom.stars.appendChild(star);

      const el = document.createElement('div');
      el.className = 'wish';
      el.style.fontSize = L.wishCenterFontSize + 'px';
      el.style.setProperty('--c', color);

      const inner = document.createElement('span');
      inner.className = 'wish__inner';
      inner.textContent = cfg.word;

      el.appendChild(inner);
      dom.wishes.appendChild(el);
      wishItems.push({ el: el, inner: inner, star: star, starBody: star.firstElementChild, cfg: cfg });
    });
  }

  function buildGreeting() {
    dom.greetingVeil.style.left = L.greeting.x + 'px';
    dom.greetingVeil.style.top = L.greeting.y + 'px';

    (CFG.greeting || []).forEach(function (cfg) {
      const el = document.createElement('p');
      el.className = 'greeting__block';
      el.style.fontSize = (cfg.fontSize || L.greeting.fontSize) + 'px';
      el.textContent = cfg.text;
      dom.greeting.appendChild(el);
      greetingBlocks.push({ el: el, cfg: cfg });
    });

    buildBirthday();
  }

  /* --- Останній кадр: геометрія серця ---
     Контур заданий у координатах viewBox (1100 × 800) і масштабується разом з обгорткою.
     Нитка — один path: стебло від подарунка + серце, намальоване одним жестом. */
  const HEART_VIEWBOX = { width: 1100, height: 800 };
  const HEART_TIP = { x: 550, y: 770 };   // нижня точка серця
  const HEART_SHAPE =
    /* Серце навмисно не симетричне: ліва дуга вища й повніша, права — нижча,
       впадина трохи лівіше центру — як у контуру, намальованого рукою. */
    /* нижня точка → ліва сторона вгору */  'C 452 702, 52 548, 58 304 ' +
    /* ліва верхня дуга */                   'C 60 148, 184 54, 316 54 ' +
    /* спуск у центральну впадину */         'C 434 54, 514 126, 541 216 ' +
    /* права верхня дуга */                  'C 574 126, 664 72, 786 76 ' +
                                             'C 928 82, 1046 172, 1042 322 ' +
    /* права сторона вниз до нижньої точки */'C 1036 556, 660 694, 556 762 ' +
    /* короткий розчерк повз точку */        'C 540 772, 522 784, 500 788';
  /* Звідки виходить нитка: трохи вище центру світла подарунка (у пікселях сцени). */
  const HEART_THREAD_LIFT = 14;

  const heart = {
    scale: 1,          // пікселів сцени в одній одиниці viewBox
    left: 0,           // лівий верхній кут намальованої області viewBox у сцені
    top: 0,
    length: 0,         // довжина всієї нитки в одиницях viewBox
    finished: false,   // нитку домальовано, покадрове оновлення більше не потрібне
    trailDebt: 0
  };

  function heartToStage(point) {
    return { x: heart.left + point.x * heart.scale, y: heart.top + point.y * heart.scale };
  }

  function stageToHeart(point) {
    return { x: (point.x - heart.left) / heart.scale, y: (point.y - heart.top) / heart.scale };
  }

  function buildBirthday() {
    const box = L.birthday;
    dom.birthday.style.left = (box.x - box.width / 2) + 'px';
    dom.birthday.style.top = (box.y - box.height / 2) + 'px';
    dom.birthday.style.width = box.width + 'px';
    dom.birthday.style.height = box.height + 'px';

    dom.birthdayLine.style.fontSize = box.lineFontSize + 'px';
    dom.birthdayName.style.fontSize = box.nameFontSize + 'px';
    setText(dom.birthdayLine, CFG.texts.birthdayLine);
    setText(dom.birthdayName, CFG.texts.birthdayName);

    /* Так само, як браузер вписує viewBox в елемент (preserveAspectRatio за замовчуванням). */
    heart.scale = Math.min(box.width / HEART_VIEWBOX.width, box.height / HEART_VIEWBOX.height);
    heart.left = box.x - HEART_VIEWBOX.width * heart.scale / 2;
    heart.top = box.y - HEART_VIEWBOX.height * heart.scale / 2;

    /* Стебло: від світла подарунка плавно входить у нижню точку серця. */
    const origin = stageToHeart({ x: L.giftLight.x, y: L.giftLight.y - HEART_THREAD_LIFT });
    const d =
      'M ' + origin.x.toFixed(1) + ' ' + origin.y.toFixed(1) + ' ' +
      'C ' + (origin.x - 8).toFixed(1) + ' ' + (origin.y - 32).toFixed(1) + ', ' +
      (HEART_TIP.x + 47) + ' ' + (HEART_TIP.y + 35) + ', ' + HEART_TIP.x + ' ' + HEART_TIP.y + ' ' +
      HEART_SHAPE;

    dom.birthdayHeart.querySelectorAll('.heart__stroke').forEach(function (path) {
      path.setAttribute('d', d);
    });

    /* Нитка схована: штрих завдовжки з усю нитку повністю «відсунутий». */
    heart.length = dom.heartPath.getTotalLength();
    dom.heartThread.style.strokeDasharray = String(heart.length + 1);
    dom.heartThread.style.strokeDashoffset = String(heart.length + 1);
  }

  /** Заповнює текстовий елемент; порожній рядок ховає його повністю. */
  function setText(el, text) {
    el.textContent = text || '';
    el.hidden = !text;
  }

  function buildScene() {
    dom.stage.style.width = CFG.stage.width + 'px';
    dom.stage.style.height = CFG.stage.height + 'px';
    byId('particles').width = CFG.stage.width;
    byId('particles').height = CFG.stage.height;

    [dom.giftLight, dom.giftBeam].forEach(function (el) {
      el.style.left = L.giftLight.x + 'px';
      el.style.top = L.giftLight.y + 'px';
    });

    dom.phraseChildhood.style.top = L.phrase.y + 'px';
    dom.phrasePresent.style.top = L.phrase.y + 'px';
    setText(dom.phraseChildhood, CFG.texts.phraseChildhood);
    setText(dom.phrasePresent, CFG.texts.phrasePresent);

    dom.startLabel.textContent = CFG.texts.startLabel;
    dom.startStar.appendChild(createStar('gold'));

    buildMemories();
    buildWishes();
    buildGreeting();
  }

  /** Розмір рамки портрета береться з пропорцій дитячого фото. */
  function sizePortrait() {
    const photo = dom.childhoodPhoto;
    const aspect = photo.naturalWidth && photo.naturalHeight
      ? photo.naturalWidth / photo.naturalHeight
      : FALLBACK_PORTRAIT_ASPECT;
    dom.portrait.style.height = L.portrait.height + 'px';
    dom.portrait.style.width = Math.round(L.portrait.height * aspect) + 'px';
  }

  /** Зменшує кегль, поки рядок ширший за дозволене (на випадок довшого тексту в конфігу). */
  function shrinkToWidth(el, maxWidth, minFontSize) {
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.offsetWidth > maxWidth && size > minFontSize) {
      size -= 1;
      el.style.fontSize = size + 'px';
    }
    if (el.offsetWidth > maxWidth) warn('Текст не вміщається по ширині: «' + el.textContent.slice(0, 30) + '…»');
  }

  function fitGreeting() {
    greetingBlocks.forEach(function (block) { shrinkToWidth(block.el, L.greeting.maxWidth, 30); });
    shrinkToWidth(dom.birthdayLine, L.birthday.textMaxWidth, 44);
    shrinkToWidth(dom.birthdayName, L.birthday.textMaxWidth, 56);
  }

  /* ----------------------------------------------------------- 3. Preload */

  const PRELOAD_TIMEOUT = 8;   // секунд; після цього стартуємо з тим, що є

  function loadImage(img, src) {
    return new Promise(function (resolve) {
      img.addEventListener('load', function () { resolve(true); }, { once: true });
      img.addEventListener('error', function () {
        warn('Не завантажилось зображення: ' + src);
        img.style.visibility = 'hidden';
        resolve(false);
      }, { once: true });
      img.src = src;
    }).then(function (loaded) {
      /* decode() заздалегідь розпаковує картинку, щоб перша поява була плавною. */
      return loaded && img.decode ? img.decode().catch(function () {}) : null;
    });
  }

  function loadMedia(media, src, label) {
    return new Promise(function (resolve) {
      media.addEventListener('canplaythrough', function () { resolve(true); }, { once: true });
      media.addEventListener('error', function () {
        warn('Не завантажилось: ' + label + ' (' + src + ')');
        resolve(false);
      }, { once: true });
      media.src = src;
      media.load();
    });
  }

  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    const sample = 'ЦІКАВІСТЬ Колись';
    return Promise.all([
      document.fonts.load('500 34px "Cormorant Garamond"', sample),
      document.fonts.load('italic 500 54px "Cormorant Garamond"', sample),
      document.fonts.load('600 96px "Cormorant Garamond"', sample),
      document.fonts.load('700 68px "Cormorant Garamond"', sample)
    ]).catch(function (error) { warn('Шрифт не завантажився, буде запасний', error); });
  }

  function preload() {
    const jobs = [
      loadImage(dom.sky, CFG.assets.background),
      loadImage(dom.childhoodPhoto, CFG.assets.childhoodPhoto),
      loadImage(dom.modernPhoto, CFG.assets.modernPhoto),
      loadFonts(),
      loadMedia(dom.video, CFG.assets.thenNowVideo, 'відео')
        .then(function (ok) { state.videoOk = ok; })
    ];

    memoryItems.forEach(function (item) {
      jobs.push(loadImage(item.img, item.cfg.src));
    });

    if (CFG.audio.src) {
      jobs.push(
        loadMedia(dom.music, CFG.audio.src, 'музика')
          .then(function (ok) { state.audioOk = ok; })
      );
    }

    const timeout = waitSeconds(PRELOAD_TIMEOUT).then(function () {
      if (!state.ready) warn('Preload триває довше ' + PRELOAD_TIMEOUT + ' с — стартуємо з тим, що є');
    });

    return Promise.race([Promise.all(jobs), timeout]);
  }

  /* ---------------------------------------------------------- 4. Годинник */

  /**
   * Єдине джерело часу. Поки грає музика — час береться з неї, тож анімація
   * не може розійтися зі звуком. Якщо музики немає або вона зупинилась,
   * годинник без стрибка продовжує йти за системним таймером.
   */
  const clock = {
    running: false,
    source: 'таймер',
    anchorTime: 0,      // останній відомий час фіналу
    anchorPerf: 0,      // performance.now() у той момент

    start: function (offset) {
      this.anchorTime = offset;
      this.anchorPerf = performance.now();
      this.running = true;
    },

    now: function () {
      if (!this.running) return this.anchorTime;
      const perf = performance.now();
      const music = dom.music;
      const musicDrives = state.audioOk && !music.paused && !music.ended && music.readyState >= 2;

      if (musicDrives) {
        this.anchorTime = music.currentTime - CFG.audio.startAt;
        this.anchorPerf = perf;
        this.source = 'музика';
        return this.anchorTime;
      }
      this.source = 'таймер';
      return this.anchorTime + (perf - this.anchorPerf) / 1000;
    },

    pause: function () {
      this.anchorTime = this.now();
      this.running = false;
    },

    resume: function () {
      this.anchorPerf = performance.now();
      this.running = true;
    }
  };

  /**
   * Гучність — чиста функція часу: плавний вхід на старті, а затихання —
   * лише після того, як екран став чорним (під час fade to black музика грає).
   */
  function updateMusicVolume(time) {
    if (!state.audioOk) return;
    const a = CFG.audio;
    const fadeIn = a.fadeIn > 0 ? Math.min(1, Math.max(0, time / a.fadeIn)) : 1;
    const fadeOut = time > ending.blackAt && a.fadeOut > 0
      ? Math.max(0, 1 - (time - ending.blackAt) / a.fadeOut)
      : 1;
    dom.music.volume = Math.max(0, Math.min(1, a.volume * fadeIn * fadeOut));
  }

  /* ---------------------------------------------------------- 5. Частинки */

  const particles = (function () {
    const canvas = byId('particles');
    const ctx = canvas.getContext('2d');
    const list = [];
    let sprite = null;
    let rate = 0;          // іскор за секунду, що піднімаються від подарунка
    let spawnDebt = 0;     // дробова частина ще не народжених іскор

    const random = function (min, max) { return min + Math.random() * (max - min); };

    /** Одна м'яка світла пляма, яку потім лише масштабуємо — це дешево. */
    function makeSprite() {
      const size = 64;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d');
      const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.22, 'rgba(255, 238, 196, 0.85)');
      gradient.addColorStop(0.55, 'rgba(255, 204, 124, 0.25)');
      gradient.addColorStop(1, 'rgba(255, 190, 110, 0)');
      g.fillStyle = gradient;
      g.fillRect(0, 0, size, size);
      return c;
    }

    function add(particle) {
      if (list.length < CFG.particles.max) list.push(particle);
    }

    /** Іскра, що повільно підіймається зі світла подарунка. */
    function spawnRising(strong) {
      add({
        x: L.giftLight.x + random(-150, 150),
        y: L.giftLight.y + random(-50, 20),
        vx: random(-14, 14),
        vy: -random(strong ? 60 : 26, strong ? 190 : 80),
        drag: 0.1,
        sway: random(0.6, 1.6),
        phase: random(0, Math.PI * 2),
        size: random(8, 22),
        age: 0,
        life: random(3.5, 7)
      });
    }

    /** Короткий розсип іскор із точки (розчинення фото, спалах зірки). */
    function burst(x, y, count, delay) {
      for (let i = 0; i < count; i += 1) {
        const angle = random(0, Math.PI * 2);
        const speed = random(18, 110);
        add({
          x: x + random(-40, 40),
          y: y + random(-50, 50),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 22,
          drag: 1.1,
          sway: 0,
          phase: random(0, Math.PI * 2),
          size: random(7, 20),
          age: -(delay || 0),          // від'ємний вік = іскра ще чекає свого моменту
          life: random(0.9, 2.1)
        });
      }
    }

    function fountain(count) {
      for (let i = 0; i < count; i += 1) spawnRising(true);
    }

    /** Кілька дуже маленьких іскор, що розлітаються з точки (іскра серця наприкінці). */
    function scatter(x, y, count) {
      for (let i = 0; i < count; i += 1) {
        const angle = random(0, Math.PI * 2);
        const speed = random(22, 70);
        add({
          x: x,
          y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          drag: 1.4,
          sway: 0,
          phase: random(0, Math.PI * 2),
          size: random(4, 9),
          age: 0,
          life: random(0.6, 1.2)
        });
      }
    }

    /** Одна маленька іскра сліду: майже нерухома і живе менше секунди. */
    function trail(x, y) {
      add({
        x: x + random(-5, 5),
        y: y + random(-5, 5),
        vx: random(-9, 9),
        vy: random(-4, 14),
        drag: 0.6,
        sway: 0,
        phase: random(0, Math.PI * 2),
        size: random(5, 12),
        age: 0,
        life: random(0.45, 0.85)
      });
    }

    function step(dt) {
      if (!sprite) sprite = makeSprite();

      spawnDebt += rate * dt;
      while (spawnDebt >= 1) {
        spawnRising(false);
        spawnDebt -= 1;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'lighter';

      for (let i = list.length - 1; i >= 0; i -= 1) {
        const p = list[i];
        p.age += dt;
        if (p.age < 0) continue;
        if (p.age >= p.life) {
          list.splice(i, 1);
          continue;
        }

        const damping = Math.max(0, 1 - p.drag * dt);
        p.vx *= damping;
        p.vy *= damping;
        p.x += (p.vx + Math.sin(p.age * p.sway + p.phase) * 16 * (p.sway ? 1 : 0)) * dt;
        p.y += p.vy * dt;

        const envelope = Math.sin(Math.PI * p.age / p.life);          // плавно з'явитись і згаснути
        const twinkle = 0.75 + 0.25 * Math.sin(p.age * 9 + p.phase);
        ctx.globalAlpha = Math.max(0, envelope * twinkle);
        ctx.drawImage(sprite, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    return {
      setRate: function (value) { rate = value; },
      burst: burst,
      fountain: fountain,
      trail: trail,
      scatter: scatter,
      step: step,
      count: function () { return list.length; }
    };
  })();

  /* --------------------------------------------------------- 6. Дії сцен */

  /* Розсипи іскор не мають сенсу, якщо момент давно минув (старт із ?t=). */
  const BURST_LATE_LIMIT = 1;

  function fadeTo(el, opacity, duration, late) {
    /* Один keyframe = «від поточного стану до нового», тому рівні не стрибають. */
    animate(el, { opacity: opacity }, { duration: duration, late: late, easing: 'ease-in-out' });
  }

  function setGiftLight(level, duration, late) { fadeTo(dom.giftLevel, level, duration, late); }
  function setSkyDim(level, duration, late) { fadeTo(dom.skyDim, level, duration, late); }

  function pulseGiftLight(strength, duration, late) {
    animate(dom.giftPulse, [
      { opacity: 0 },
      { opacity: strength, offset: 0.3 },
      { opacity: 0 }
    ], { duration: duration, late: late, easing: 'ease-out' });
  }

  /* --- Старт --- */

  function openScene(late) {
    animate(dom.start, [
      { opacity: 1, transform: 'translateY(0) scale(1)', filter: 'blur(0px)' },
      { opacity: 0, transform: 'translateY(-18px) scale(1.06)', filter: 'blur(8px)' }
    ], { duration: T.startLabelFade, late: late, easing: 'ease-in' });
    dom.start.style.pointerEvents = 'none';

    /* Дуже повільний наїзд на небо на весь фінал — м'який паралакс відносно зірок і тексту. */
    animate(dom.sky, [
      { transform: 'scale(1)' },
      { transform: 'scale(' + CFG.stage.skyDriftScale + ')' }
    ], { duration: ending.blackAt, late: late, easing: 'ease-in-out' });

    setGiftLight(0.3, 4, late);
    particles.setRate(CFG.particles.calmRate);
  }

  /* --- Фрази Act I–II --- */

  function showPhrase(el, late) {
    animate(el, [
      { opacity: 0, filter: 'blur(14px)', transform: 'translateY(-50%) scale(1.03)' },
      { opacity: 1, filter: 'none', transform: 'translateY(-50%) scale(1)' }
    ], { duration: T.phraseFade, late: late, easing: EASE_OUT });
  }

  function hidePhrase(el, late) {
    animate(el, [
      { opacity: 1, filter: 'none' },
      { opacity: 0, filter: 'blur(10px)' }
    ], { duration: T.phraseFade * 0.7, late: late, easing: 'ease-in' });
  }

  /* --- Act I–II: портрет --- */

  /* Стан «у світлі подарунка»: маленький, розмитий, пересвічений. */
  function portraitInLight() {
    return {
      opacity: 0,
      transform: placeAt(L.giftLight.x, L.giftLight.y - 30, 'scale(0.2)'),
      filter: 'blur(18px) brightness(2.6)'
    };
  }

  function portraitAtRest() {
    return {
      opacity: 1,
      transform: placeAt(L.portrait.x, L.portrait.y, 'scale(1)'),
      filter: 'none'
    };
  }

  function portraitEmerge(late) {
    animate(dom.portrait, [
      portraitInLight(),
      { opacity: 0.92, filter: 'blur(5px) brightness(1.5)', offset: 0.55 },
      portraitAtRest()
    ], { duration: T.childhoodEmerge, late: late, easing: EASE_OUT });

    setGiftLight(0.75, 1.6, late);
    pulseGiftLight(0.6, T.childhoodEmerge, late);
    setSkyDim(0.12, 3, late);
  }

  function playThenNowVideo(late) {
    const video = dom.video;
    const duration = getVideoDuration();
    /* Якщо відео немає або ми вже проскочили його — лишається фото, далі спрацює підміна. */
    if (!state.videoOk || late >= duration - T.modernSwapLead) return;

    /* Дитяче фото лежить поверх відео і зникає лише коли відео справді показало кадр. */
    const revealVideo = function () {
      animate(dom.childhoodPhoto, [{ opacity: 1 }, { opacity: 0 }], { duration: 0.35 });
    };

    try {
      if (late > 0.05) video.currentTime = late;
      if (video.requestVideoFrameCallback) {
        video.requestVideoFrameCallback(revealVideo);
      } else {
        video.addEventListener('playing', revealVideo, { once: true });
      }
      const playing = video.play();
      if (playing && playing.catch) {
        playing.catch(function (error) { warn('Відео не запустилось — показуємо фото', error); });
      }
    } catch (error) {
      warn('Відео не запустилось — показуємо фото', error);
    }
  }

  /** Непомітна підміна останніх кадрів відео оригінальним фото. Безпечно викликати повторно. */
  function swapToModernPhoto(late) {
    if (state.modernShown) return;
    state.modernShown = true;
    animate(dom.modernPhoto, [{ opacity: 0 }, { opacity: 1 }],
      { duration: T.modernSwapFade, late: late || 0, easing: 'ease-in-out' });
  }

  function portraitDissolve(late) {
    animate(dom.portrait, [
      portraitAtRest(),
      { opacity: 0.9, filter: 'blur(4px) brightness(1.6)', offset: 0.4 },
      portraitInLight()
    ], { duration: T.modernLeave, late: late, easing: 'ease-in' });

    pulseGiftLight(0.75, T.modernLeave + 1.2, late);
    setSkyDim(0.06, 2, late);
  }

  function retirePortrait() {
    try { dom.video.pause(); } catch (error) { /* відео могло й не стартувати */ }
    dom.portrait.style.visibility = 'hidden';
  }

  /* --- Act III: спогади --- */

  function memoryCenterTransform() {
    return placeAt(L.memoryCenter.x, L.memoryCenter.y, 'rotate(0deg) scale(1)');
  }

  function memorySlotTransform(cfg, lift, grow) {
    const scale = (cfg.slot.height / cfg.centerHeight) * (grow || 1);
    return placeAt(cfg.slot.x, cfg.slot.y - (lift || 0),
      'rotate(' + cfg.slot.rotate + 'deg) scale(' + scale + ')');
  }

  function memoryEnter(index, late) {
    const item = memoryItems[index];
    item.el.style.zIndex = '20';   // фото в центрі завжди над галереєю
    animate(item.el, [
      {
        opacity: 0,
        transform: placeAt(L.memoryCenter.x, L.memoryCenter.y + 46, 'rotate(0deg) scale(0.9)'),
        filter: 'blur(10px) brightness(1.7)'
      },
      { opacity: 1, transform: memoryCenterTransform(), filter: 'none' }
    ], { duration: T.memoryEnter, late: late, easing: EASE_OUT });

    pulseGiftLight(0.3, 1.4, late);
  }

  function memoryTravel(index, late) {
    const item = memoryItems[index];
    item.el.style.zIndex = String(index + 1);
    animate(item.el, [
      { transform: memoryCenterTransform() },
      { transform: memorySlotTransform(item.cfg) }
    ], { duration: T.memoryTravel, late: late, easing: EASE_IN_OUT });
  }

  function memoriesDissolve(late) {
    const STAGGER = 0.16;
    memoryItems.forEach(function (item, index) {
      const delay = index * STAGGER;
      animate(item.el, [
        { opacity: 1, transform: memorySlotTransform(item.cfg), filter: 'blur(0px) brightness(1)' },
        { opacity: 0, transform: memorySlotTransform(item.cfg, 26, 1.1), filter: 'blur(9px) brightness(2.2)' }
      ], { duration: T.memoriesDissolve, delay: delay, late: late, easing: 'ease-in' });

      if (late < BURST_LATE_LIMIT) {
        particles.burst(item.cfg.slot.x, item.cfg.slot.y, 16, delay + T.memoriesDissolve * 0.3);
      }
    });
    setSkyDim(0.16, 3, late);
  }

  /* --- Act IV: 12 побажань --- */

  const STAR_POINT = { opacity: 0.8, transform: 'scale(0.3)' };   // тьмяна точка до активації

  function starPointsAppear(late) {
    wishItems.forEach(function (item, index) {
      animate(item.starBody, [{ opacity: 0, transform: 'scale(0.05)' }, STAR_POINT],
        { duration: 0.9, delay: index * 0.13, late: late, easing: EASE_OUT });
    });
    particles.setRate(CFG.particles.wishesRate);
  }

  function wishCenterTransform(scale) {
    return placeAt(L.wishCenter.x, L.wishCenter.y, 'scale(' + scale + ')');
  }

  /** Зірка спалахує на арці, а її слово проявляється великим у центрі. */
  function wishActivate(index, pace, late) {
    const item = wishItems[index];
    const wordIn = Math.min(0.65, Math.max(0.4, pace * 0.22));

    animate(item.starBody, [
      STAR_POINT,
      { opacity: 1, transform: 'scale(1.35)', offset: 0.45 },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: 0.9, late: late, easing: EASE_OUT });

    animate(item.el, [
      { opacity: 0, transform: wishCenterTransform(0.92), filter: 'blur(12px)' },
      { opacity: 1, transform: wishCenterTransform(1), filter: 'none' }
    ], { duration: wordIn, delay: 0.12, late: late, easing: EASE_OUT });

    pulseGiftLight(0.28, 1.1, late);
    if (late < BURST_LATE_LIMIT) particles.burst(item.cfg.star.x, item.cfg.star.y, 9, 0);
  }

  /** Слово зменшується і стає на своє місце під зіркою. */
  function wishTravel(index, late) {
    const item = wishItems[index];
    const labelScale = L.wishLabelFontSize / L.wishCenterFontSize;
    animate(item.el, [
      { transform: wishCenterTransform(1) },
      {
        transform: placeAt(item.cfg.star.x, item.cfg.star.y + L.wishLabelOffset,
          'scale(' + labelScale + ')')
      }
    ], { duration: T.wishTravel, late: late, easing: EASE_IN_OUT });
  }

  /* --- Act V: зірки повертаються в подарунок --- */

  const GIFT_LEVEL_BEFORE_STARS = 0.4;   // рівень світла подарунка під час Act IV
  const GIFT_LEVEL_ALL_STARS = 1;        // після дванадцятої зірки
  const STAR_ENTRY_LIFT = 18;            // зірка входить трохи вище центру світла — у відкриту коробку
  const STAR_PATH_BOW = 0.2;             // вигин траєкторії як частка її довжини
  const STAR_PATH_SAMPLES = 24;          // на скільки відрізків ділимо криву для анімації
  const STAR_FADE_FROM = 0.9;            // з цієї частки шляху зірка вже гасне в коробці — слід не потрібен

  /* Зірки, що зараз у польоті, — щоб лишати за ними короткий слід з іскор. */
  const starFlights = [];   // { path, startedAt, trailDebt }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  /**
   * Траєкторія зірки до подарунка: плавна дуга (квадратична крива Безьє),
   * вигнута вгору, щоб зірка заходила в коробку згори, а не летіла по прямій.
   * Повертає функцію progress (0…1) → { x, y }; розгін і гальмування вже всередині.
   */
  function createStarPath(cfg, index) {
    const from = cfg.star;
    const to = { x: L.giftLight.x, y: L.giftLight.y - STAR_ENTRY_LIFT };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;

    /* Перпендикуляр до прямої «зірка → подарунок», спрямований угору. */
    let normalX = -dy / distance;
    let normalY = dx / distance;
    if (normalY > 0) {
      normalX = -normalX;
      normalY = -normalY;
    }

    /* Вигин трохи різний у кожної зірки — рух виглядає органічним, але не хаотичним. */
    const bow = distance * (STAR_PATH_BOW + 0.05 * Math.sin(index * 1.9));
    const control = {
      x: from.x + dx / 2 + normalX * bow,
      y: from.y + dy / 2 + normalY * bow
    };

    return function (progress) {
      const t = easeInOutCubic(Math.min(1, Math.max(0, progress)));
      const u = 1 - t;
      return {
        x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * control.y + t * t * to.y
      };
    };
  }

  function wishLabelsFade(late) {
    wishItems.forEach(function (item) {
      animate(item.el, [
        { opacity: 1, filter: 'blur(0px)' },
        { opacity: 0, filter: 'blur(6px)' }
      ], { duration: T.wishLabelFade, late: late, easing: 'ease-in-out' });
    });
  }

  function starDepart(index, late) {
    const item = wishItems[index];
    const from = item.cfg.star;
    const path = createStarPath(item.cfg, index);

    /* Крива вже містить розгін і гальмування, тому між точками йдемо рівномірно. */
    const keyframes = [];
    for (let k = 0; k <= STAR_PATH_SAMPLES; k += 1) {
      const point = path(k / STAR_PATH_SAMPLES);
      keyframes.push({
        transform: 'translate(' + (point.x - from.x).toFixed(1) + 'px, ' + (point.y - from.y).toFixed(1) + 'px)'
      });
    }
    animate(item.star, keyframes, { duration: T.starCollectionDuration, late: late, easing: 'linear' });

    /* Наближаючись до коробки, зірка меншає і в самому кінці розчиняється у світлі. */
    animate(item.starBody, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 1, transform: 'scale(0.6)', offset: 0.78 },
      { opacity: 0, transform: 'scale(0.18)' }
    ], { duration: T.starCollectionDuration, late: late, easing: 'ease-in' });

    if (late < T.starCollectionDuration) {
      starFlights.push({ path: path, startedAt: timelineNow - late, trailDebt: 0 });
    }
  }

  /** Короткий делікатний слід: кілька іскор на секунду в точці, де щойно була зірка. */
  function updateStarTrails(time, dt) {
    for (let i = starFlights.length - 1; i >= 0; i -= 1) {
      const flight = starFlights[i];
      const progress = (time - flight.startedAt) / T.starCollectionDuration;

      if (progress >= STAR_FADE_FROM) {
        starFlights.splice(i, 1);
        continue;
      }
      if (progress < 0) continue;

      flight.trailDebt += CFG.particles.starTrailRate * dt;
      if (flight.trailDebt >= 1) {
        const point = flight.path(progress);
        while (flight.trailDebt >= 1) {
          particles.trail(point.x, point.y);
          flight.trailDebt -= 1;
        }
      }
    }
  }

  /** Зірка увійшла в коробку: короткий теплий імпульс, світло стає на сходинку сильнішим. */
  function starArrive(index, late) {
    const total = wishItems.length;
    const share = (index + 1) / total;
    const level = GIFT_LEVEL_BEFORE_STARS + (GIFT_LEVEL_ALL_STARS - GIFT_LEVEL_BEFORE_STARS) * share;
    const isLast = index === total - 1;

    setGiftLight(level, 0.8, late);

    if (!isLast) {
      pulseGiftLight(0.42, 0.9, late);
      if (late < BURST_LATE_LIMIT) particles.fountain(3);
      return;
    }

    /* Остання зірка — сильніший, але теплий імпульс: без білого спалаху на весь екран. */
    pulseGiftLight(0.85, 2.6, late);
    fadeTo(dom.giftBeam, 0.34, 2.2, late);
    animate(dom.warmVeil, [
      { opacity: 0 },
      { opacity: 0.3, offset: 0.35 },
      { opacity: 0.06 }
    ], { duration: 3, late: late, easing: 'ease-out' });
    if (late < BURST_LATE_LIMIT) particles.fountain(22);
  }

  /* --- Act VI: привітання --- */

  /** Сцена затихає і трохи темнішає навколо тексту; фон лишається видимим. */
  function greetingOpen(late) {
    particles.setRate(CFG.particles.greetingRate);
    setGiftLight(0.72, 3, late);
    fadeTo(dom.giftBeam, 0.14, 3, late);
    setSkyDim(0.3, 2.4, late);
    fadeTo(dom.greetingVeil, 1, 2.4, late);
  }

  function greetingTransform(shiftY) {
    return placeAt(L.greeting.x, L.greeting.y + shiftY);
  }

  function greetingBlockIn(index, late) {
    animate(greetingBlocks[index].el, [
      { opacity: 0, transform: greetingTransform(10), filter: 'blur(8px)' },
      { opacity: 1, transform: greetingTransform(0), filter: 'none' }
    ], { duration: T.greetingTransitionDuration, late: late, easing: EASE_OUT });
  }

  function greetingBlockOut(index, late) {
    animate(greetingBlocks[index].el, [
      { opacity: 1, transform: greetingTransform(0), filter: 'blur(0px)' },
      { opacity: 0, transform: greetingTransform(-8), filter: 'blur(6px)' }
    ], { duration: T.greetingTransitionDuration, late: late, easing: 'ease-in' });
  }

  /* --- Act VII: фінальний титр --- */

  /** Перед титром подарунок трохи сильніше освітлює сцену і здіймає невелику хвилю іскор. */
  function birthdayPrelude(late) {
    setGiftLight(1, 2.2, late);
    pulseGiftLight(0.5, 3, late);
    fadeTo(dom.giftBeam, 0.42, 2.6, late);
    setSkyDim(0.22, 2.6, late);
    fadeTo(dom.greetingVeil, 0.62, 2.6, late);
    particles.setRate(CFG.particles.finaleRate);
    if (late < BURST_LATE_LIMIT) particles.fountain(10);
  }

  function birthdayTitleIn(late) {
    /* translate(-50%, -50%) тримає текст по центру обгортки (див. .birthday__title). */
    animate(dom.birthdayTitle, [
      { opacity: 0, transform: 'translate(-50%, -50%) scale(0.96)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', filter: 'none' }
    ], { duration: T.birthdayTitleFade, late: late, easing: EASE_OUT });
  }

  /* --- Серце: одна нитка, один рух --- */

  const HEART_BREATH_PERIOD = 3.4;   // секунд на один «вдих» яскравості 100% → 115%
  const HEART_PULSE_DURATION = 1.3;  // хвиля світла по готовій нитці

  /* Рух починається спокійно, прискорюється і плавно сповільнюється перед завершенням. */
  function easeInOutSine(t) {
    return 0.5 - 0.5 * Math.cos(Math.PI * t);
  }

  /** Іскра народжується у світлі подарунка — з цього моменту нитка починає рости. */
  function heartDrawStart(late) {
    animate(dom.heartSparkBody, [
      { opacity: 0, transform: 'scale(0.4)' },
      { opacity: 1, transform: 'scale(1)' }
    ], { duration: 0.4, late: late, easing: 'ease-out' });
    pulseGiftLight(0.3, 1.2, late);
  }

  /**
   * Викликається в кожному кадрі. Одне число — пройдена довжина — керує і ниткою
   * (stroke-dashoffset), і іскрою (точка на path), тому вони не можуть розійтися.
   */
  function updateHeartThread(time, dt) {
    if (heart.finished || time < ending.heartDrawAt) return;

    const progress = Math.min(1, (time - ending.heartDrawAt) / T.heartDrawDuration);
    const drawn = heart.length * easeInOutSine(progress);

    dom.heartThread.style.strokeDashoffset = String(heart.length + 1 - drawn);

    const tip = dom.heartPath.getPointAtLength(drawn);
    dom.heartSpark.setAttribute('transform', 'translate(' + tip.x.toFixed(1) + ' ' + tip.y.toFixed(1) + ')');

    if (progress >= 1) {
      heart.finished = true;
      return;
    }

    /* Дуже короткий слід: рідкі дрібні іскри в точці, де щойно був кінчик нитки. */
    heart.trailDebt += CFG.particles.heartTrailRate * dt;
    if (heart.trailDebt >= 1) {
      const point = heartToStage(tip);
      while (heart.trailDebt >= 1) {
        particles.trail(point.x, point.y);
        heart.trailDebt -= 1;
      }
    }
  }

  /** Контур замкнувся: хвиля світла по нитці, короткий імпульс, іскра розсипається. */
  function heartComplete(late) {
    /* Яскрава ділянка один раз пробігає всією ниткою — від подарунка до кінця розчерку. */
    const shimmerLength = heart.length * 0.14;
    dom.heartShimmer.style.strokeDasharray = shimmerLength + ' ' + (heart.length + shimmerLength);
    animate(dom.heartShimmer, [
      { strokeDashoffset: shimmerLength, opacity: 0 },
      { opacity: 0.85, offset: 0.15 },
      { opacity: 0.85, offset: 0.8 },
      { strokeDashoffset: -heart.length, opacity: 0 }
    ], { duration: HEART_PULSE_DURATION, late: late, easing: 'ease-in-out' });

    /* Серце на мить стає трохи яскравішим — без білого спалаху. */
    animate(dom.birthdayHeart, [
      { filter: 'brightness(1)' },
      { filter: 'brightness(1.4)', offset: 0.4 },
      { filter: 'brightness(1)' }
    ], { duration: HEART_PULSE_DURATION, late: late, easing: 'ease-out' });
    pulseGiftLight(0.35, 1.6, late);

    /* Іскра дійшла до кінця і розсипається на кілька дрібних частинок. */
    animate(dom.heartSparkBody, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(2.2)' }
    ], { duration: 0.6, late: late, easing: 'ease-out' });
    if (late < BURST_LATE_LIMIT) {
      const end = heartToStage(dom.heartPath.getPointAtLength(heart.length));
      particles.scatter(end.x, end.y, 7);
    }

  }

  /** Далі живе лише світло: яскравість 100% → 115% → 100%, дуже повільно, без зміни розміру. */
  function heartBreathe(late) {
    animate(dom.birthdayHeart, [
      { filter: 'brightness(1)' },
      { filter: 'brightness(1.15)' }
    ], {
      duration: HEART_BREATH_PERIOD,
      late: late,
      easing: 'ease-in-out',
      iterations: Infinity,
      direction: 'alternate'
    });
  }

  function fadeToBlack(late) {
    animate(dom.blackout, [{ opacity: 0 }, { opacity: 1 }],
      { duration: T.finalFadeDuration, late: late, easing: 'ease-in-out' });
  }

  function finish() {
    state.finished = true;   // екран чорний: іскри більше не малюємо, музика стихає сама
  }

  /* ---------------------------------------------------------- 7. Timeline */

  function getVideoDuration() {
    const duration = dom.video.duration;
    return isFinite(duration) && duration > 0 ? duration : FALLBACK_VIDEO_DURATION;
  }

  /** Тривалість кожного з 12 слів; якщо в конфігу їх менше — добираємо останнім значенням. */
  function getWishPace() {
    const pace = T.wishPace || [];
    const fallback = pace.length ? pace[pace.length - 1] : 2.2;
    return CFG.wishes.map(function (_, index) {
      return pace[index] !== undefined ? pace[index] : fallback;
    });
  }

  /* Подарунок починає яскравішати на самому початку паузи перед титром. */
  const PRELUDE_AFTER_GREETING = 0.2;
  /* Сцена починає затихати трохи раніше, ніж з'являється перший блок привітання. */
  const GREETING_OPEN_LEAD = 0.6;

  /* Розклад усього, що йде після 12 побажань. Заповнюється у buildCues(). */
  let ending = { blackAt: 0, heartDrawAt: Infinity };

  /**
   * Рахує моменти фінальної частини від кінця останнього слова.
   * Усе задано тривалостями з конфігу, тому ця частина не може наїхати на Act IV.
   */
  function planEnding(wishesEnd) {
    const labelsFadeAt = wishesEnd + T.wishHoldDuration;
    const collectionAt = labelsFadeAt + T.wishLabelFade;
    const lastStarInAt = collectionAt +
      Math.max(0, CFG.wishes.length - 1) * T.starCollectionGap + T.starCollectionDuration;
    const greetingAt = lastStarInAt + T.greetingPause;

    let cursor = greetingAt;
    const blocks = greetingBlocks.map(function (block) {
      const hold = block.cfg.hold !== undefined ? block.cfg.hold : T.greetingBlockDuration;
      const inAt = cursor;
      const outAt = inAt + T.greetingTransitionDuration + hold;
      cursor = outAt + T.greetingTransitionDuration + T.greetingGap;
      return { inAt: inAt, outAt: outAt };
    });
    const greetingEndAt = blocks.length ? cursor - T.greetingGap : greetingAt;

    const preludeAt = greetingEndAt + PRELUDE_AFTER_GREETING;
    const titleAt = greetingEndAt + T.birthdayTitlePause;
    const heartDrawAt = titleAt + T.birthdayTitleFade + T.heartPause;
    const heartDoneAt = heartDrawAt + T.heartDrawDuration;
    const fadeAt = heartDoneAt + T.birthdayTitleHoldDuration;

    return {
      labelsFadeAt: labelsFadeAt,
      collectionAt: collectionAt,
      lastStarInAt: lastStarInAt,
      greetingAt: greetingAt,
      blocks: blocks,
      preludeAt: preludeAt,
      titleAt: titleAt,
      heartDrawAt: heartDrawAt,
      heartDoneAt: heartDoneAt,
      fadeAt: fadeAt,
      blackAt: fadeAt + T.finalFadeDuration
    };
  }

  /** Перетворює конфіг на плоский список cues: { at, act, name, run(late) }. */
  function buildCues() {
    const cues = [];
    const add = function (at, act, name, run) {
      cues.push({ at: at, act: act, name: name, run: run });
    };

    const videoDuration = getVideoDuration();
    const swapAt = T.videoAt + videoDuration - T.modernSwapLead;
    const P = CFG.particles;

    /* Старт */
    add(0, 'старт', 'сцена оживає', openScene);

    /* Act I — дитинство */
    add(T.phraseChildhoodAt, 'Act I', 'фраза про дитинство', function (late) { showPhrase(dom.phraseChildhood, late); });
    add(T.childhoodAt, 'Act I', 'дитяче фото зі світла', portraitEmerge);
    add(T.childhoodAt + T.childhoodEmerge, 'Act I', 'світло заспокоюється', function (late) { setGiftLight(0.4, 2, late); });
    add(T.videoAt, 'Act I', 'старт відео', playThenNowVideo);
    add(T.videoAt + T.videoGlowOffset, 'Act I', 'світло вторить спалаху у відео', function (late) { pulseGiftLight(0.7, 2.4, late); });
    add(T.phraseChildhoodOutAt, 'Act I', 'фраза зникає', function (late) { hidePhrase(dom.phraseChildhood, late); });

    /* Act II — сьогодення */
    add(swapAt, 'Act II', 'підміна відео → фото', swapToModernPhoto);
    add(T.phrasePresentAt, 'Act II', 'фраза про сьогодення', function (late) { showPhrase(dom.phrasePresent, late); });
    add(T.phrasePresentOutAt, 'Act II', 'фраза зникає', function (late) { hidePhrase(dom.phrasePresent, late); });
    add(T.modernLeaveAt, 'Act II', 'фото розчиняється у світлі', portraitDissolve);
    add(T.modernLeaveAt + T.modernLeave, 'Act II', 'портрет прибрано', retirePortrait);

    /* Act III — спогади */
    add(T.memoriesAt, 'Act III', 'більше іскор', function () { particles.setRate(P.memoriesRate); });
    memoryItems.forEach(function (_, index) {
      const enterAt = T.memoriesAt + index * T.memoryStep;
      add(enterAt, 'Act III', 'фото ' + (index + 1) + ' у центрі', function (late) { memoryEnter(index, late); });
      add(enterAt + T.memoryEnter + T.memoryHold, 'Act III', 'фото ' + (index + 1) + ' летить у галерею',
        function (late) { memoryTravel(index, late); });
    });

    /* Act IV — 12 побажань */
    add(T.memoriesDissolveAt, 'Act IV', 'галерея розчиняється', memoriesDissolve);
    add(T.starPointsAt, 'Act IV', '12 точок на арці', starPointsAppear);

    let wishAt = T.wishesAt;
    getWishPace().forEach(function (pace, index) {
      const word = CFG.wishes[index].word;
      add(wishAt, 'Act IV', 'зірка ' + (index + 1) + ': ' + word, function (late) { wishActivate(index, pace, late); });
      add(wishAt + Math.max(0.5, pace - T.wishTravel), 'Act IV', word + ' стає під зірку',
        function (late) { wishTravel(index, late); });
      wishAt += pace;
    });

    /* Тут wishAt — момент, коли останнє слово стало під свою зірку.
       Усе далі рахується від нього тривалостями. */
    ending = planEnding(wishAt);

    /* Act V — зірки повертаються в подарунок */
    add(ending.labelsFadeAt, 'Act V', 'слова біля зірок зникають', wishLabelsFade);
    wishItems.forEach(function (item, index) {
      const departAt = ending.collectionAt + index * T.starCollectionGap;
      add(departAt, 'Act V', 'зірка ' + item.cfg.word + ' летить до подарунка',
        function (late) { starDepart(index, late); });
      add(departAt + T.starCollectionDuration, 'Act V', 'зірка ' + item.cfg.word + ' у подарунку',
        function (late) { starArrive(index, late); });
    });

    /* Act VI — привітання */
    add(ending.greetingAt - GREETING_OPEN_LEAD, 'Act VI', 'сцена затихає перед привітанням', greetingOpen);
    ending.blocks.forEach(function (block, index) {
      add(block.inAt, 'Act VI', 'привітання, блок ' + (index + 1), function (late) { greetingBlockIn(index, late); });
      add(block.outAt, 'Act VI', 'блок ' + (index + 1) + ' зникає', function (late) { greetingBlockOut(index, late); });
    });

    /* Act VII — фінальний титр і затемнення */
    add(ending.preludeAt, 'Act VII', 'подарунок освітлює сцену', birthdayPrelude);
    add(ending.titleAt, 'Act VII', 'З Днем народження, Аня!', birthdayTitleIn);
    add(ending.heartDrawAt, 'Act VII', 'нитка починає малювати серце', heartDrawStart);
    add(ending.heartDoneAt, 'Act VII', 'серце намальоване', heartComplete);
    add(ending.heartDoneAt + HEART_PULSE_DURATION, 'Act VII', 'серце «дихає» світлом', heartBreathe);
    add(ending.fadeAt, 'Act VII', 'fade to black', fadeToBlack);
    add(ending.blackAt, 'кінець', 'екран чорний', finish);

    /* Стабільне сортування: cues з однаковим часом ідуть у порядку додавання. */
    return cues.sort(function (a, b) { return a.at - b.at; });
  }

  /** Перевіряє, що акти в конфігу не наїжджають один на одного. Лише попереджає. */
  function validateTimeline() {
    const videoEnd = T.videoAt + getVideoDuration();
    const memoryCycle = T.memoryEnter + T.memoryHold + T.memoryTravel;
    const memoriesEnd = T.memoriesAt + (CFG.memories.length - 1) * T.memoryStep + memoryCycle;

    const rules = [
      [T.childhoodAt + T.childhoodEmerge <= T.videoAt, 'videoAt раніше, ніж дитяче фото встигає проявитись'],
      [videoEnd <= T.modernLeaveAt, 'modernLeaveAt раніше, ніж закінчується відео (' + videoEnd.toFixed(1) + ' с)'],
      [T.modernLeaveAt + T.modernLeave <= T.memoriesAt, 'memoriesAt раніше, ніж сучасне фото встигає зникнути'],
      [memoryCycle <= T.memoryStep, 'memoryStep коротший за появу + паузу + політ фото (' + memoryCycle.toFixed(1) + ' с)'],
      [memoriesEnd <= T.memoriesDissolveAt, 'memoriesDissolveAt раніше, ніж остання фото стає на місце (' + memoriesEnd.toFixed(1) + ' с)'],
      [T.memoriesDissolveAt + T.memoriesDissolve <= T.wishesAt, 'wishesAt раніше, ніж галерея встигає розчинитись'],
      [(T.wishPace || []).length === CFG.wishes.length, 'у wishPace не стільки значень, скільки слів у wishes'],
      [T.starCollectionGap > 0, 'starCollectionGap має бути більшим за 0 — зірки входять у подарунок по черзі'],
      [greetingBlocks.length > 0, 'список greeting порожній — привітання не буде показано']
    ];

    rules.forEach(function (rule) {
      if (!rule[0]) warn('Таймінг: ' + rule[1]);
    });
  }

  /* --------------------------------------------------------- 8. Sequencer */

  let cues = [];
  let cueIndex = 0;
  let rafId = 0;
  let lastFramePerf = 0;
  let timelineNow = 0;         // час фіналу в поточному кадрі (потрібен діям, що стартують «заднім числом»)

  const MAX_FRAME_DT = 0.05;   // після паузи/фонової вкладки частинки не «стрибають»

  function tick() {
    rafId = window.requestAnimationFrame(tick);

    const perf = performance.now();
    const dt = Math.min(MAX_FRAME_DT, (perf - lastFramePerf) / 1000);
    lastFramePerf = perf;

    if (!state.paused) {
      const time = clock.now();
      timelineNow = time;

      while (cueIndex < cues.length && cues[cueIndex].at <= time) {
        const cue = cues[cueIndex];
        cueIndex += 1;
        state.act = cue.act;
        /* Помилка однієї дії не має зупиняти весь фінал. */
        try {
          cue.run(time - cue.at);
        } catch (error) {
          warn('Дія «' + cue.name + '» завершилась помилкою', error);
        }
      }

      updateMusicVolume(time);
      if (!state.finished) {
        updateStarTrails(time, dt);
        updateHeartThread(time, dt);
        particles.step(dt);
      }
    }

    if (DEBUG) renderDebug();
  }

  /* ------------------------------------------- 9. Старт, debug, прибирання */

  function enterFullscreen() {
    if (!CFG.stage.requestFullscreen) return;
    const root = document.documentElement;
    try {
      const request = root.requestFullscreen && root.requestFullscreen();
      if (request && request.catch) request.catch(function () { /* заборонено — не критично */ });
    } catch (error) { /* не критично */ }
  }

  /** Запускає музику в межах того ж кліку. Ніколи не блокує старт довше ніж на 1.5 с. */
  function startMusic() {
    if (!state.audioOk) return Promise.resolve();
    const music = dom.music;
    try {
      music.volume = 0;
      music.currentTime = CFG.audio.startAt + START_OFFSET;
      const playing = music.play()
        .catch(function (error) {
          state.audioOk = false;
          warn('Музика не запустилась — фінал іде без звуку', error);
        });
      return Promise.race([playing, waitSeconds(1.5)]);
    } catch (error) {
      state.audioOk = false;
      warn('Музика не запустилась — фінал іде без звуку', error);
      return Promise.resolve();
    }
  }

  function start() {
    if (state.started || !state.ready) return;   // захист від подвійного запуску
    state.started = true;

    enterFullscreen();
    if (CFG.stage.hideCursor && !DEBUG) document.body.classList.add('is-playing');

    startMusic().then(function () {
      cues = buildCues();
      cueIndex = 0;
      clock.start(START_OFFSET);
      lastFramePerf = performance.now();
      tick();
    });
  }

  /* --- Debug: таймкод і пауза (клавіша P) --- */

  let pausedAnimations = [];
  let videoWasPlaying = false;

  function togglePause() {
    if (!state.started) return;
    state.paused = !state.paused;

    if (state.paused) {
      clock.pause();
      pausedAnimations = document.getAnimations().filter(function (a) { return a.playState === 'running'; });
      pausedAnimations.forEach(function (a) { a.pause(); });
      videoWasPlaying = !dom.video.paused;
      dom.video.pause();
      dom.music.pause();
    } else {
      pausedAnimations.forEach(function (a) { a.play(); });
      pausedAnimations = [];
      if (videoWasPlaying) dom.video.play().catch(function () {});
      if (state.audioOk) dom.music.play().catch(function () {});
      clock.resume();
    }
  }

  function renderDebug() {
    const lines = [
      't = ' + clock.now().toFixed(2) + ' с   ' + state.act + (state.paused ? '   [ПАУЗА]' : ''),
      'годинник: ' + clock.source + '   cues: ' + cueIndex + '/' + cues.length +
        '   іскор: ' + particles.count() + '   чорний екран на ' + ending.blackAt.toFixed(1) + ' с',
      'P — пауза   ?t=62 — старт із 62-ї секунди'
    ];
    warnings.slice(-6).forEach(function (message) { lines.push('⚠ ' + message); });
    dom.debug.textContent = lines.join('\n');
  }

  function bindEvents() {
    window.addEventListener('resize', fitStage);
    document.addEventListener('fullscreenchange', fitStage);

    dom.stage.addEventListener('click', start);
    document.addEventListener('keydown', function (event) {
      if (DEBUG && state.started && (event.key === 'p' || event.key === 'P' || event.key === 'з' || event.key === 'З')) {
        togglePause();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') start();
    });

    /* Запасні шляхи для відео: якщо воно закінчилось або зламалось раніше за cue підміни. */
    dom.video.addEventListener('ended', function () { swapToModernPhoto(0); });
    dom.video.addEventListener('error', function () {
      if (state.started) swapToModernPhoto(0);
    });

    /* Якщо музика зламалась посеред показу — годинник сам перейде на таймер. */
    dom.music.addEventListener('error', function () {
      if (state.audioOk) warn('Музика перервалась — продовжуємо без звуку');
      state.audioOk = false;
    });

    window.addEventListener('pagehide', function () {
      window.cancelAnimationFrame(rafId);
      try { dom.video.pause(); dom.music.pause(); } catch (error) { /* сторінка вже закривається */ }
    });
  }

  function init() {
    fitStage();
    buildScene();
    bindEvents();

    preload().then(function () {
      sizePortrait();
      fitGreeting();
      validateTimeline();

      state.ready = true;
      dom.stage.classList.add('is-ready');

      if (DEBUG) {
        dom.debug.hidden = false;
        cues = buildCues();   // лише щоб показати кількість cues до старту
        renderDebug();
      }
    });
  }

  init();
})();
