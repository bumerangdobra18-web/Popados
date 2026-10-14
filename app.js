/* ПОПАДОС — логика сайта.
 * Данные лежат в папке data/ (site.json, events.json, gallery.json, faq.json).
 * Редактировать этот файл для обычных изменений не нужно: см. docs/КАК-РЕДАКТИРОВАТЬ.md
 */
(function () {
  "use strict";

  var ROOT = document.body.getAttribute("data-root") || "./";
  var TZ_OFFSET = "+04:00";          // Ижевск, UTC+4
  var HIDE_AFTER_START_HOURS = 3;    // игра пропадает из расписания через 3 часа после начала
  var TC_BASE = "https://ticketscloud.com";
  var TC_SCRIPT = "https://ticketscloud.com/static/scripts/widget/tcwidget.js";
  var PLACEHOLDER_POSTER = "assets/img/posters/placeholder.svg";

  var MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  var MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  var MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  var WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

  /* ---------- утилиты ---------- */
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function get(obj, path) {
    return path.split(".").reduce(function (o, k) { return o && o[k] != null ? o[k] : undefined; }, obj);
  }
  function str(v) { return typeof v === "string" ? v.trim() : (v == null ? "" : String(v)); }
  function isAbs(url) { return /^(https?:)?\/\//i.test(url) || /^data:/i.test(url); }
  function asset(url) { return !url ? "" : isAbs(url) ? url : ROOT + url.replace(/^\.?\//, ""); }
  function safeUrl(url) { url = str(url); return /^https:\/\//i.test(url) ? url : ""; }

  function loadJSON(name) {
    return fetch(ROOT + "data/" + name, { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(name + ": HTTP " + r.status); return r.json(); })
      .catch(function (err) { console.error("[ПОПАДОС] не удалось загрузить data/" + name, err); return null; });
  }

  /* ---------- меню ---------- */
  function initMenu() {
    var btn = $(".burger"), nav = $("#site-nav");
    if (!btn || !nav) return;
    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
      btn.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    }
    btn.addEventListener("click", function () { setOpen(btn.getAttribute("aria-expanded") !== "true"); });
    $all("a", nav).forEach(function (a) { a.addEventListener("click", function () { setOpen(false); }); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
  }

  /* ---------- настройки сайта ---------- */
  function applySite(site) {
    $all("[data-site]").forEach(function (el) {
      var v = get(site, el.getAttribute("data-site"));
      if (v && el.getAttribute("data-site") !== "city") el.textContent = v;
    });
    $all("[data-site-href]").forEach(function (el) {
      var v = safeUrl(get(site, el.getAttribute("data-site-href")));
      if (v) el.href = v;
    });
    var address = get(site, "venue.address");
    $all("[data-map-link]").forEach(function (a) {
      if (address) a.href = "https://yandex.ru/maps/?text=" + encodeURIComponent(address);
    });
    var y = $("[data-year]"); if (y) y.textContent = new Date().getFullYear();

    var c = site.contacts || {}, items = [];
    if (str(c.phone)) items.push('<li><a href="tel:' + esc(str(c.phone).replace(/[^\d+]/g, "")) + '">' + esc(c.phone) + "</a></li>");
    if (str(c.telegram)) {
      var tg = str(c.telegram).replace(/^@/, "").replace(/^https:\/\/t\.me\//, "");
      items.push('<li><a href="https://t.me/' + esc(tg) + '" target="_blank" rel="noopener">Telegram: @' + esc(tg) + "</a></li>");
    }
    if (str(c.email)) items.push('<li><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a></li>");
    $all("[data-contacts]").forEach(function (ul) { ul.innerHTML = items.join(""); });

    var privacy = safeUrl(get(site, "leadForm.privacyPolicyUrl")) || (str(get(site, "leadForm.privacyPolicyUrl")) ? asset(str(get(site, "leadForm.privacyPolicyUrl"))) : "");
    $all("[data-privacy-link]").forEach(function (a) { if (privacy) a.href = privacy; });
    $all("[data-privacy-footer]").forEach(function (p) { p.hidden = !privacy; });
    return privacy;
  }

  /* ---------- Ticketscloud ---------- */
  var tcLoaded = false;
  function loadTicketscloud() {
    if (tcLoaded) return;
    tcLoaded = true;
    var s = document.createElement("script");
    s.src = TC_SCRIPT;
    s.async = true;
    s.onerror = function () { console.warn("[ПОПАДОС] скрипт Ticketscloud не загрузился, кнопки откроют оформление в новой вкладке"); };
    document.head.appendChild(s);
  }

  /* Ссылка на официальную страницу оформления Ticketscloud — та же, что открывает их виджет. */
  function tcWidgetUrl(id, isMeta, tc) {
    var q = isMeta ? "/v1/widgets/common/meta?meta_event=" : "/v1/widgets/common?event=";
    return TC_BASE + q + encodeURIComponent(id) + "&token=" + encodeURIComponent(tc.token) + "&lang=" + encodeURIComponent(tc.lang || "ru");
  }

  /* Кнопка покупки. Возвращает "" если покупка не настроена — фиктивных кнопок не показываем. */
  function buyButton(opts, tc, label, cls) {
    label = label || "Купить билет";
    cls = cls || "btn btn-red";
    var token = tc && str(tc.token);
    if (opts.tcEvent && token) {
      loadTicketscloud();
      return '<a class="' + cls + '" href="' + esc(tcWidgetUrl(opts.tcEvent, opts.tcMeta, tc)) + '" target="_blank" rel="noopener"' +
        ' data-tc-event="' + esc(opts.tcEvent) + '" data-tc-token="' + esc(token) + '" data-tc-lang="' + esc(tc.lang || "ru") + '"' +
        (opts.tcMeta ? ' data-tc-meta="true"' : "") + ">" + esc(label) + "</a>";
    }
    var url = safeUrl(opts.url);
    if (url) return '<a class="' + cls + '" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(label) + "</a>";
    return "";
  }

  /* ---------- события ---------- */
  function parseEvent(raw, site, now) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.published === false) return null;
    var date = str(raw.date), m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!m) { console.warn("[ПОПАДОС] у игры нет даты в формате ГГГГ-ММ-ДД, она не показана:", raw); return null; }
    var time = str(raw.time);
    if (time && !/^\d{1,2}:\d{2}$/.test(time)) { console.warn("[ПОПАДОС] время должно быть в формате ЧЧ:ММ:", raw); time = ""; }
    var hhmm = time ? (time.length === 4 ? "0" + time : time) : "23:59";
    var start = Date.parse(date + "T" + hhmm + ":00" + TZ_OFFSET);
    if (isNaN(start)) return null;
    var hide = time ? start + HIDE_AFTER_START_HOURS * 3600e3 : start + 60e3;
    if (now > hide) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    var price = raw.price;
    var priceText = typeof price === "number" ? price.toLocaleString("ru-RU") + " ₽" : str(price);
    var venue = get(site, "venue") || {};
    return {
      id: str(raw.id) || date + "-" + hhmm,
      title: str(raw.title) || "ПОПАДОС: музыкальное бинго",
      date: date, time: time, start: start,
      day: d, month: mo, year: y,
      weekday: WEEKDAYS[new Date(Date.UTC(y, mo, d)).getUTCDay()],
      venue: str(raw.venue) || str(venue.name),
      address: str(raw.address) || (str(raw.venue) ? "" : str(venue.address)),
      priceText: priceText,
      image: str(raw.image),
      description: str(raw.description),
      ticketUrl: str(raw.ticketUrl),
      tcEvent: str(raw.ticketscloudEvent)
    };
  }

  function eventBuy(ev, tc, cls) {
    return buyButton({ tcEvent: ev.tcEvent, tcMeta: false, url: ev.ticketUrl }, tc, "Купить билет", cls);
  }

  function eventCard(ev, tc, headingTag) {
    var h = headingTag || "h3";
    var img = ev.image ? asset(ev.image) : ROOT + PLACEHOLDER_POSTER;
    var buy = eventBuy(ev, tc);
    var meta = '<li><strong>' + esc(ev.day + " " + MONTHS_GEN[ev.month]) + "</strong>, " + esc(ev.weekday) + (ev.time ? " · " + esc(ev.time) : "") + "</li>";
    if (ev.venue || ev.address) meta += "<li>" + esc(ev.venue) + (ev.venue && ev.address ? ", " : "") + esc(ev.address) + "</li>";
    return '<article class="event-card">' +
      '<div class="event-poster"><img src="' + esc(img) + '" alt="' + (ev.image ? "Афиша: " + esc(ev.title) : "") + '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' + esc(ROOT + PLACEHOLDER_POSTER) + '\'">' +
      '<div class="event-badge" aria-hidden="true"><b>' + ev.day + "</b><small>" + MONTHS_SHORT[ev.month] + "</small></div></div>" +
      '<div class="event-body"><' + h + ">" + esc(ev.title) + "</" + h + ">" +
      '<ul class="event-meta">' + meta + "</ul>" +
      (ev.description ? '<p class="event-desc">' + esc(ev.description) + "</p>" : "") +
      '<div class="event-foot">' + (ev.priceText ? '<span class="event-price">' + esc(ev.priceText) + "</span>" : "<span></span>") +
      (buy || '<p class="event-note">Продажа билетов скоро откроется</p>') + "</div></div></article>";
  }

  var EMPTY_ICON = '<svg class="empty-icon" viewBox="0 0 72 72" aria-hidden="true"><rect width="72" height="72" rx="20" fill="#6C4CF1"/><circle cx="36" cy="36" r="17" fill="#F0243F"/><circle cx="36" cy="36" r="4.5" fill="#fff"/></svg>';

  function emptyState(site, onSchedulePage) {
    var tc = site.ticketscloud || {};
    var meta = str(tc.metaEvent);
    var buyAll = meta ? buyButton({ tcEvent: meta, tcMeta: true }, tc, "Билеты в Ticketscloud", "btn btn-red") : "";
    var vk = safeUrl(get(site, "vk.url"));
    return '<div class="empty">' + EMPTY_ICON + "<div>" +
      "<h3>Новые даты скоро появятся</h3>" +
      "<p>Мы готовим ближайшие игры." + (buyAll ? " Если продажа уже открыта, билеты доступны в Ticketscloud." : "") + " Анонсы первыми выходят в нашем сообществе ВКонтакте.</p>" +
      '<div class="btns">' + buyAll + (vk ? '<a class="btn btn-ghost" href="' + esc(vk) + '" target="_blank" rel="noopener">Следить в VK</a>' : "") +
      (onSchedulePage ? "" : "") + "</div></div></div>";
  }

  function jsonLd(events, site) {
    var data = events.map(function (ev) {
      var o = {
        "@context": "https://schema.org", "@type": "Event", name: ev.title,
        startDate: ev.date + (ev.time ? "T" + (ev.time.length === 4 ? "0" + ev.time : ev.time) + ":00" + TZ_OFFSET : ""),
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
        location: { "@type": "Place", name: ev.venue || ev.address, address: ev.address || ev.venue },
        organizer: { "@type": "Organization", name: "ПОПАДОС", url: safeUrl(get(site, "vk.url")) || undefined }
      };
      if (ev.description) o.description = ev.description;
      if (ev.image) o.image = new URL(asset(ev.image), location.href).href;
      return o;
    });
    if (!data.length) return;
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  function renderEvents(site, eventsData) {
    var tc = site.ticketscloud || {};
    var now = Date.now();
    var list = (eventsData && Array.isArray(eventsData.events) ? eventsData.events : [])
      .map(function (e) { return parseEvent(e, site, now); })
      .filter(Boolean)
      .sort(function (a, b) { return a.start - b.start; });

    $all("[data-events]").forEach(function (box) {
      var mode = box.getAttribute("data-events");
      if (!list.length) { box.innerHTML = emptyState(site, mode === "all"); return; }
      if (mode === "all") {
        var groups = [], cur = null;
        list.forEach(function (ev) {
          var key = ev.year + "-" + ev.month;
          if (!cur || cur.key !== key) { cur = { key: key, label: MONTHS_NOM[ev.month] + (ev.year !== new Date().getFullYear() ? " " + ev.year : ""), items: [] }; groups.push(cur); }
          cur.items.push(ev);
        });
        box.innerHTML = groups.map(function (g) {
          return '<section class="month-group"><h2>' + esc(g.label) + '</h2><div class="events-grid">' +
            g.items.map(function (ev) { return eventCard(ev, tc, "h3"); }).join("") + "</div></section>";
        }).join("");
      } else {
        var limit = parseInt(box.getAttribute("data-limit"), 10) || 3;
        box.innerHTML = list.slice(0, limit).map(function (ev) { return eventCard(ev, tc, "h3"); }).join("");
      }
    });

    var next = $("[data-next-game]");
    if (next) {
      if (list.length) {
        var ev = list[0];
        var buy = eventBuy(ev, tc, "btn btn-violet btn-sm");
        next.innerHTML = '<div class="next-card"><div class="next-date" aria-hidden="true"><b>' + ev.day + "</b><small>" + MONTHS_SHORT[ev.month] + "</small></div>" +
          '<div class="next-body"><p class="next-label">Ближайшая игра</p><p class="next-title">' + esc(ev.title) + "</p>" +
          '<p class="next-meta">' + esc(ev.day + " " + MONTHS_GEN[ev.month]) + (ev.time ? ", " + esc(ev.time) : "") + (ev.venue ? " · " + esc(ev.venue) : "") + "</p></div>" +
          (buy || '<a class="btn btn-ghost btn-sm" href="' + ROOT + 'schedule/">Подробнее</a>') + "</div>";
      } else {
        next.innerHTML = '<p class="next-meta">Ближайшие даты публикуем в <a href="' + ROOT + 'schedule/">расписании</a> и в нашем сообществе VK.</p>';
      }
    }
    jsonLd(list, site);
  }

  /* ---------- галерея ---------- */
  var NOTE_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="FILL" d="M30 6v22.5a7 7 0 1 1-4-6.3V12l-10 2.5v18a7 7 0 1 1-4-6.3V9z"/></svg>';
  var CHIP_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20" fill="FILL"/><circle cx="24" cy="24" r="5" fill="#fff"/></svg>';
  function renderGallery(data) {
    var box = $("[data-gallery]");
    if (!box) return;
    var items = (data && Array.isArray(data.items) ? data.items : []).filter(function (i) { return i && (i.src || i.video); });
    if (!items.length) {
      box.innerHTML =
        '<div class="ph ph-a">' + CHIP_SVG.replace("FILL", "#F0243F") + "</div>" +
        '<div class="ph ph-c">' + NOTE_SVG.replace("FILL", "#F0243F") + "</div>" +
        '<div class="ph ph-b">' + NOTE_SVG.replace("FILL", "#6C4CF1") + "</div>" +
        '<p class="ph-caption">Фото и видео с первых игр появятся здесь совсем скоро.</p>';
      return;
    }
    box.innerHTML = items.slice(0, 7).map(function (i) {
      var alt = esc(i.alt || "Атмосфера игры ПОПАДОС");
      var video = safeUrl(i.video);
      var img = i.src ? '<img src="' + esc(asset(i.src)) + '" alt="' + alt + '" loading="lazy" decoding="async">' : '<div class="ph ph-a" style="height:100%">' + CHIP_SVG.replace("FILL", "#F0243F") + "</div>";
      if (video) return '<figure><a href="' + esc(video) + '" target="_blank" rel="noopener" aria-label="Смотреть видео: ' + alt + '">' + img + '<span class="play" aria-hidden="true"></span></a></figure>';
      return "<figure>" + img + "</figure>";
    }).join("");
  }

  /* ---------- виджет VK (официальный Open API) ---------- */
  function initVkWidget(site) {
    var box = $("[data-vk-widget]");
    var id = get(site, "vk.groupId");
    if (!box || !id || get(site, "vk.showPostsWidget") === false) return;
    function load() {
      var s = document.createElement("script");
      s.src = "https://vk.com/js/api/openapi.js?169";
      s.async = true;
      s.onload = function () {
        if (!window.VK || !VK.Widgets) return;
        box.innerHTML = '<div id="vk_groups"></div>';
        box.hidden = false;
        try {
          VK.Widgets.Group("vk_groups", { mode: 4, no_cover: 0, wide: 1, width: "auto", height: 520, color3: "6C4CF1" }, id);
        } catch (e) { box.hidden = true; console.warn("[ПОПАДОС] виджет VK не загрузился", e); }
      };
      s.onerror = function () { console.warn("[ПОПАДОС] VK Open API недоступен, показываем только ссылку на сообщество"); };
      document.head.appendChild(s);
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); load(); }
      }, { rootMargin: "400px" });
      io.observe(box.parentNode);
    } else { load(); }
  }

  /* ---------- FAQ ---------- */
  function renderFaq(data, site) {
    var box = $("[data-faq]");
    if (!box) return;
    var items = data && Array.isArray(data.items) ? data.items : [];
    function fill(t) {
      return esc(t).replace(/\{venue\}/g, esc(get(site, "venue.name") || "")).replace(/\{address\}/g, esc(get(site, "venue.address") || "")).replace(/\{city\}/g, esc(site.city || ""));
    }
    box.innerHTML = items.filter(function (i) { return i && i.q && i.a; }).map(function (i) {
      return '<details><summary>' + esc(i.q) + '</summary><div class="answer"><p>' + fill(i.a) + "</p></div></details>";
    }).join("");
  }

  /* ---------- форма заявки ---------- */
  function initLeadForm(site, privacy) {
    var form = $("[data-lead-form]");
    if (!form) return;
    var endpoint = safeUrl(get(site, "leadForm.endpoint"));
    var status = $("[data-form-status]", form);
    var submit = $('button[type="submit"]', form);

    if (!endpoint || !privacy) {
      // Приём заявок не настроен: не имитируем отправку, предлагаем написать в VK.
      $all(".field, .field-row", form).forEach(function (el) { el.hidden = true; });
      submit.hidden = true;
      var vk = safeUrl(get(site, "vk.url"));
      var note = document.createElement("div");
      note.className = "form-off";
      note.innerHTML = "<p>Онлайн-заявки скоро заработают. А пока напишите нам — обсудим дату, формат и количество гостей.</p>" +
        (vk ? '<a class="btn btn-violet btn-block" href="' + esc(vk) + '" target="_blank" rel="noopener">Написать во ВКонтакте</a>' : "");
      form.insertBefore(note, $("h3", form).nextSibling);
      return;
    }

    $("[data-consent]", form).hidden = false;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.className = "form-status";
      var name = form.elements.name, contact = form.elements.contact, consent = form.elements.consent;
      var bad = [];
      [name, contact].forEach(function (el) { var ok = !!el.value.trim(); el.setAttribute("aria-invalid", String(!ok)); if (!ok) bad.push(el); });
      if (bad.length) { status.classList.add("is-error"); status.textContent = "Заполните имя и контакт для связи."; bad[0].focus(); return; }
      if (!consent.checked) { status.classList.add("is-error"); status.textContent = "Нужно согласие на обработку персональных данных."; consent.focus(); return; }

      var fd = new FormData(form);
      fd.append("source", location.href);
      submit.disabled = true;
      status.textContent = "Отправляем…";
      fetch(endpoint, { method: "POST", body: fd, headers: { Accept: "application/json" } })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          form.reset();
          status.classList.add("is-ok");
          status.textContent = "Заявка отправлена! Мы свяжемся с вами в ближайшее время.";
        })
        .catch(function (err) {
          console.error("[ПОПАДОС] заявка не отправлена", err);
          status.classList.add("is-error");
          status.textContent = "Не получилось отправить заявку. Попробуйте ещё раз или напишите нам во ВКонтакте.";
        })
        .then(function () { submit.disabled = false; });
    });
  }

  /* ---------- запуск ---------- */
  initMenu();
  Promise.all([loadJSON("site.json"), loadJSON("events.json"), loadJSON("gallery.json"), loadJSON("faq.json")])
    .then(function (r) {
      var site = r[0] || {};
      var privacy = applySite(site);
      renderEvents(site, r[1]);
      renderGallery(r[2]);
      renderFaq(r[3], site);
      initLeadForm(site, privacy);
      initVkWidget(site);
    });
})();
