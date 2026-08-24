/* CompApp.ui — generic modal/toast/datebox DOM helpers shared by every view + workflow file */
window.CompApp = window.CompApp || {};
CompApp.ui = (function () {
  "use strict";
  var esc = CompApp.schema.esc, normDate = CompApp.schema.normDate, validDate = CompApp.schema.validDate;
  var $ = function (id) { return document.getElementById(id); };
  var t = function (s) { return CompApp.i18n ? CompApp.i18n.t(s) : s; };

  // normalize any YYYY-MM-DD text field on blur (bubbles via focusout)
  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('datefield')) {
      e.target.value = normDate(e.target.value);
      var box = e.target.closest && e.target.closest('.datebox');
      if (box) { var n = box.querySelector('.dp-native'); if (n) n.value = validDate(e.target.value) ? e.target.value : ''; }
    }
  });

  // YYYY-MM-DD text field + calendar-icon picker
  function dateFieldHTML(id, value) {
    value = value || '';
    return '<span class="datebox"><input type="text" class="datefield" id="' + id + '" value="' + esc(value) + '" placeholder="YYYY-MM-DD" inputmode="numeric" maxlength="10" autocomplete="off"><input type="date" class="dp-native" value="' + esc(value) + '" tabindex="-1" aria-label="' + esc(t('달력')) + '"></span>';
  }
  function wireDateBoxes(root) {
    (root || document).querySelectorAll('.datebox').forEach(function (box) {
      if (box._wired) return; box._wired = true;
      var txt = box.querySelector('.datefield'), nat = box.querySelector('.dp-native');
      if (!txt || !nat) return;
      nat.addEventListener('input', function () { if (nat.value) { txt.value = nat.value; txt.dispatchEvent(new Event('change', { bubbles: true })); } });
      txt.addEventListener('change', function () { var v = normDate(txt.value); txt.value = v; nat.value = validDate(v) ? v : ''; });
    });
  }
  function setDate(id, v) {
    var el = $(id); if (!el) return; el.value = v || '';
    var box = el.closest ? el.closest('.datebox') : null;
    if (box) { var nat = box.querySelector('.dp-native'); if (nat) nat.value = validDate(v) ? v : ''; }
  }

  // F: optional one-shot action button (used by 1-step undo). Existing single-string callers
  // are unaffected — opts is entirely optional. When an action is offered, the toast waits for an
  // explicit choice (되돌리기 or 확인) instead of auto-dismissing, so a processed batch never
  // disappears before the user decides whether to undo it.
  function toast(m, opts) {
    opts = opts || {};
    var el = $('toast');
    var html = '<span class="toast-msg">' + esc(m) + '</span>';
    if (opts.actionLabel) html += '<button type="button" class="toast-action">' + esc(opts.actionLabel) + '</button><button type="button" class="toast-confirm">' + t('확인') + '</button>';
    el.innerHTML = html;
    el.classList.toggle('has-action', !!opts.actionLabel);
    el.classList.add('show');
    clearTimeout(el._t);
    if (opts.actionLabel) {
      if (opts.onAction) {
        el.querySelector('.toast-action').addEventListener('click', function (e) {
          e.stopPropagation();
          el.classList.remove('show');
          opts.onAction();
        });
      }
      el.querySelector('.toast-confirm').addEventListener('click', function (e) {
        e.stopPropagation();
        el.classList.remove('show');
      });
      // no auto-dismiss — stays until 되돌리기 or 확인 is clicked
    } else {
      el._t = setTimeout(function () { el.classList.remove('show'); }, 2200);
    }
  }

  // ---- generic modal ----
  function modal(o) {
    $('gen-title').textContent = o.title || '';
    var sub = $('gen-sub'); if (o.sub) { sub.textContent = o.sub; sub.style.display = 'block'; } else sub.style.display = 'none';
    $('gen-body').innerHTML = o.bodyHtml || ''; $('gen-err').textContent = ''; wireDateBoxes($('gen-body'));
    var acts = $('gen-actions'); acts.innerHTML = '';
    (o.buttons || []).forEach(function (b) {
      var el = document.createElement('button'); el.className = 'btn ' + (b.cls || 'btn-ghost'); el.type = 'button'; el.textContent = b.label;
      el.addEventListener('click', function () {
        if (b.onClick) { var keep = b.onClick($('gen-body'), function (msg) { $('gen-err').textContent = msg; }); if (keep === false) return; }
        close();
      });
      acts.appendChild(el);
    });
    $('genBackdrop').classList.add('show');
    if (o.wire) o.wire($('gen-body'));
    function close() { $('genBackdrop').classList.remove('show'); }
    return close;
  }

  // ---- black-out tag editor (G: structured black-out input) ----
  // Renders into containerEl: existing tag chips (removable) + a preset-add row, a date-range-add
  // row, and a free-text-add row. `prefix` must be unique per simultaneous instance (issue form vs
  // edit modal never render at the same time, but a stable prefix per call site avoids id clashes).
  // getPresets() is called once at construction; call the returned refreshPresets() after the
  // preset list changes elsewhere (e.g. the preset-management modal).
  function wireBlackoutEditor(prefix, containerEl, initialTags, getPresets) {
    var blackoutTagLabel = CompApp.schema.blackoutTagLabel;
    var tags = (initialTags || []).slice();
    function paintTags() {
      var box = document.getElementById(prefix + '-tags'); if (!box) return;
      box.innerHTML = tags.map(function (t, i) { return '<span class="bo-tag">' + esc(blackoutTagLabel(t)) + '<button type="button" data-i="' + i + '">×</button></span>'; }).join('');
      box.querySelectorAll('button[data-i]').forEach(function (btn) { btn.addEventListener('click', function () { tags.splice(parseInt(btn.dataset.i, 10), 1); paintTags(); }); });
    }
    function paint() {
      var presets = getPresets ? getPresets() : [];
      containerEl.innerHTML = '<div class="tagrow" id="' + prefix + '-tags"></div>'
        + '<div style="display:flex;gap:6px;margin-bottom:5px;flex-wrap:wrap"><select id="' + prefix + '-preset" style="flex:1;min-width:120px"><option value="">' + t('프리셋에서 추가…') + '</option>'
        + presets.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('') + '</select>'
        + dateFieldHTML(prefix + '-from', '') + dateFieldHTML(prefix + '-to', '')
        + '<button type="button" class="btn btn-ghost btn-sm" id="' + prefix + '-addrange" style="white-space:nowrap">' + t('기간 추가') + '</button></div>'
        + '<div style="display:flex;gap:6px"><input type="text" id="' + prefix + '-text" placeholder="' + esc(t('자유 입력 후 추가')) + '"><button type="button" class="btn btn-ghost btn-sm" id="' + prefix + '-addtext" style="white-space:nowrap">' + t('추가') + '</button></div>';
      wireDateBoxes(containerEl);
      paintTags();
      document.getElementById(prefix + '-preset').addEventListener('change', function () {
        if (this.value && this.value !== '블랙아웃 없음') { tags.push({ type: 'preset', label: this.value }); paintTags(); }
        this.value = '';
      });
      document.getElementById(prefix + '-addrange').addEventListener('click', function () {
        var from = normDate(document.getElementById(prefix + '-from').value), to = normDate(document.getElementById(prefix + '-to').value);
        if (!validDate(from) || !validDate(to)) return;
        tags.push({ type: 'range', from: from, to: to });
        setDate(prefix + '-from', ''); setDate(prefix + '-to', ''); paintTags();
      });
      document.getElementById(prefix + '-addtext').addEventListener('click', function () {
        var v = document.getElementById(prefix + '-text').value.trim(); if (!v) return;
        tags.push({ type: 'text', label: v }); document.getElementById(prefix + '-text').value = ''; paintTags();
      });
    }
    function refreshPresets() {
      var sel = document.getElementById(prefix + '-preset'); if (!sel) return;
      var presets = getPresets ? getPresets() : [];
      sel.innerHTML = '<option value="">' + t('프리셋에서 추가…') + '</option>' + presets.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join('');
    }
    paint();
    // relabel: full re-paint from the current `tags` closure (not the DOM), so it's safe to call
    // after a language switch — existing tags/entered text survive, only the chrome re-translates.
    return { getTags: function () { return tags.slice(); }, refreshPresets: refreshPresets, relabel: paint };
  }

  return { $: $, dateFieldHTML: dateFieldHTML, wireDateBoxes: wireDateBoxes, setDate: setDate, toast: toast, modal: modal, wireBlackoutEditor: wireBlackoutEditor };
})();
