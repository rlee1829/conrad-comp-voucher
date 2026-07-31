/* CompApp.db — local in-memory persistence (Phase 1: no Supabase yet).
   Exposes CompApp.db.cache.records as the single shared array reference; every other file
   mutates this array in place (push/unshift/splice), never reassigns it. */
window.CompApp = window.CompApp || {};
CompApp.db = (function () {
  "use strict";
  var prod = CompApp.schema.prod, uid = CompApp.schema.uid;

  var seed = [
    { fam: 'FB', serial: 'FB012276', product: 'fb_buffet2', issued: '2025-07-28', valid: '2026-08-31', cat: 'STAFF', purpose: 'Team Member 우수사원 포상', req: 'Scott Park (HR)', mate: '2025-4201', status: 'ACTIVE' },
    { fam: 'FB', serial: 'FB012277', product: 'fb_10g_cake', issued: '2025-07-28', valid: '2026-02-28', cat: 'STAFF', purpose: 'Team Member 포상 (Whole Cake)', req: 'Scott Park (HR)', mate: '2025-4200', status: 'USED', usedDate: '2025-12-20' },
    { fam: 'FB', serial: 'FB012279', product: 'fb_buffet2', issued: '2025-08-06', valid: '2026-08-31', cat: 'COMPLAINT', purpose: '인하우스 게스트 샤워 배수 불량 컴플레인 보상', req: 'Hanna Kwak (Front Desk)', mate: '2025-4314', status: 'ACTIVE' },
    { fam: 'FB', serial: 'FB012280', product: 'fb_val_150', issued: '2025-11-01', valid: '2026-11-30', cat: 'PARTNER', purpose: 'Park Hyatt Seoul 바우처 교환', req: 'Scott Park (HR)', mate: '2025-4527', status: 'ACTIVE' },
    { fam: 'FB', serial: 'FB012305', product: 'fb_buffet_l2', issued: '2025-09-15', valid: '2026-09-30', cat: 'VIP', purpose: 'Company of the Month · Bloomberg', req: 'Yeeun Kim (Sales)', mate: '2025-4402', status: 'ACTIVE' },
    { fam: 'FB', serial: 'FB012333', product: 'fb_val_50', issued: '2026-07-10', valid: '2027-07-31', cat: 'COMPLAINT', purpose: '객실 소음 컴플레인 보상', req: '이지은 (Finance)', mate: '', status: 'PENDING' },
    { fam: 'FB', serial: 'FB012201', product: 'fb_10g_americano', issued: '2025-08-01', valid: '2026-02-01', cat: 'STAFF', purpose: 'AWOS Week 팀 활동 럭키드로우', req: 'Duke Hong (HR)', mate: '2025-4180', status: 'ACTIVE' },
    { fam: 'RM', serial: 'RM010037', product: 'rm_deluxe_2n', issued: '2025-09-01', valid: '2026-08-31', cat: 'PARTNER', purpose: 'Conrad Hong Kong 25주년 지원', req: 'Sam (GM)', mate: '2025-3507', status: 'USED', usedDate: '2026-01-15' },
    { fam: 'RM', serial: 'RM010116', product: 'rm_deluxe_2n', issued: '2025-07-28', valid: '2026-10-31', cat: 'PARTNER', purpose: 'Hilton Nagoya Annual Event 지원', req: 'Sam (GM)', mate: '2025-4232', status: 'ACTIVE' },
    { fam: 'RM', serial: 'RM009606', product: 'rm_deluxe_1n', issued: '2025-11-27', valid: '2026-08-31', cat: 'PARTNER', purpose: 'Conrad Manila 교환', req: 'Yebeen Yu (OPS Admin)', mate: '2024-8064 → 2026-2687', status: 'ACTIVE' },
    { fam: 'RM', serial: 'RM010250', product: 'rm_val_100', issued: '2025-12-10', valid: '2026-12-31', cat: 'VIP', purpose: 'Daiwa Securities · Conrad Miles 교환 (100pt→₩100,000)', req: 'Grace Jin (BD)', mate: '2026-0112', status: 'ACTIVE' },
    { fam: 'RM', serial: 'RM010318', product: 'rm_exec_1n', issued: '2026-03-02', valid: '2027-03-31', cat: 'STAFF', purpose: '13th Service Anniversary', req: 'Jayne Choi (HR)', mate: '2026-0771', status: 'ACTIVE' },
    { fam: 'RM', serial: 'RM009540', product: 'rm_val_50', issued: '2025-07-30', valid: '2026-07-30', cat: 'VIP', purpose: 'KBS Symphony · Conrad Miles 교환', req: 'Grace Jin (BD)', mate: '2025-4090', status: 'ACTIVE' },
    { fam: 'FB', serial: 'FB012340', product: 'fb_buffet2', issued: '2026-07-02', valid: '2027-07-31', cat: 'VIP', purpose: 'Company of the Month · McKinsey', req: 'Yeeun Kim (Sales)', mate: '2026-3901', status: 'USED', usedDate: '2026-07-22' },
    { fam: 'FB', serial: 'FB012341', product: 'fb_val_100', issued: '2026-07-05', valid: '2027-07-31', cat: 'PARTNER', purpose: 'Grand Hyatt 바우처 교환', req: 'Joann Hwang (MarComm)', mate: '2026-3925', status: 'ACTIVE' },
    { fam: 'FB', serial: 'FB012342', product: 'fb_buffet2', issued: '2026-07-12', valid: '2027-07-31', cat: 'STAFF', purpose: '7th Service Anniversary', req: 'Jayne Choi (HR)', mate: '2026-3980', status: 'USED', usedDate: '2026-07-25' },
    { fam: 'FB', serial: 'FB012343', product: 'fb_10g_cake', issued: '2026-07-20', valid: '2027-01-31', cat: 'COMPLAINT', purpose: '조식 지연 컴플레인 보상', req: 'Hanna Kwak (Front Desk)', mate: '2026-4010', status: 'ACTIVE' },
    { fam: 'RM', serial: 'RM010360', product: 'rm_deluxe_1n', issued: '2026-07-03', valid: '2027-07-31', cat: 'COMPLAINT', purpose: '객실 에어컨 고장 보상', req: 'Brandon Lim (FD)', mate: '2026-3910', status: 'USED', usedDate: '2026-07-24' },
    { fam: 'RM', serial: 'RM010361', product: 'rm_val_100', issued: '2026-07-08', valid: '2027-07-31', cat: 'VIP', purpose: 'Deloitte · Conrad Miles 교환', req: 'Grace Jin (BD)', mate: '2026-3948', status: 'ACTIVE' },
    { fam: 'RM', serial: 'RM010362', product: 'rm_exec_1n', issued: '2026-07-18', valid: '2027-07-31', cat: 'PARTNER', purpose: 'Hilton Saigon 바우처 교환', req: 'Sam (GM)', mate: '2026-4002', status: 'ACTIVE' },
    { fam: 'HR', serial: 'HRF 000286', product: 'hr_fb100', issued: '2026-07-05', valid: '2027-01-31', cat: 'STAFF', purpose: '근속 7주년', req: 'Scott Park (HR)', mate: '2026-3890', status: 'ACTIVE', remark: '201268 임서영 / Atrio Kitchen' },
    { fam: 'HR', serial: 'HRC 000050', product: 'hr_cake', issued: '2026-07-05', valid: '2027-01-31', cat: 'STAFF', purpose: '근속 2주년', req: 'Scott Park (HR)', mate: '2026-3890', status: 'USED', usedDate: '2026-07-22', remark: '201263 최수민 / Pulse 8' },
    { fam: 'HR', serial: 'HRZ 000034', product: 'hr_buffet', issued: '2026-06-10', valid: '2026-12-31', cat: 'STAFF', purpose: '근속 3주년', req: 'Scott Park (HR)', mate: '2026-3701', status: 'ACTIVE', remark: '201147 임윤미 / Atrio' },
    { fam: 'HR', serial: 'HRF 000287', product: 'hr_fb100', issued: '2026-07-14', valid: '2027-01-31', cat: 'STAFF', purpose: '근속 4주년', req: 'Duke Hong (HR)', mate: '2026-3990', status: 'ACTIVE', remark: '101050 이경호 / Culinary' },
    { fam: 'HR', serial: 'HRF 000180', product: 'hr_fb100', issued: '2026-01-14', valid: '2026-05-31', cat: 'STAFF', purpose: '근속 9주년', req: 'Scott Park (HR)', mate: '2026-0101', status: 'EXPIRED', remark: '101044 정찬규 / Zest' }
  ];

  var records = seed.map(function (s) {
    var p = prod(s.fam, s.product);
    var r = Object.assign({ id: uid(), amount: (p ? p.amount : 0), blackout: '', remark: '', history: [] }, s);
    r.history.push({ ts: s.issued, actor: s.req, action: '발행', detail: '발행 등록' + (s.status === 'PENDING' ? ' (승인대기)' : ' · Mate ' + s.mate) });
    if (s.status === 'USED') r.history.push({ ts: s.usedDate, actor: '—', action: '사용', detail: '사용 처리' });
    return r;
  });

  var cache = { records: records };

  return { cache: cache };
})();
