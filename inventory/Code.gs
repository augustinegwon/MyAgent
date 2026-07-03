/**
 * ============================================================================
 *  회사 물품 인벤토리 관리 시스템  (Google Sheets + Apps Script)
 * ============================================================================
 *
 *  [보이는 시트 3개]
 *   - 마스터   : 물품별·위치별 수량 + 총합 + 상태요약. 자동생성·편집금지(보호).
 *   - 물품편집 : 물품 등록/이동/상태변경/수량조정을 입력하는 폼 + 조회 결과.
 *   - 이동로그 : 모든 변화가 타임스탬프와 함께 append 되는 이력 로그.
 *
 *  [숨김 시트 2개 — 엔진]
 *   - 재고원장(_LEDGER) : 현재고의 단일 진실원본(Source of Truth).
 *   - _목록            : 드롭다운(물품명/위치)용 자동 목록.
 *
 *  데이터 모델
 *   - 시리얼관리 물품 : 시리얼번호 = 고유키, 수량은 항상 1.
 *   - 수량관리 물품   : (물품명 + 위치 + 상태) = 고유키, 수량 ≥ 1.
 *
 *  사용법: 상단 메뉴 '📦 인벤토리' → '⚙️ 초기 설정' 1회 실행.
 * ============================================================================
 */

// ----- 상수 -----
const SHEETS = {
  MASTER: '마스터',
  EDIT:   '물품편집',
  LOG:    '이동로그',
  LEDGER: '재고원장',   // 숨김
  LISTS:  '_목록',      // 숨김
};

const STATUS  = ['정상', '고장', '수리중'];
const MGMT    = ['시리얼관리', '수량관리'];
const ACTIONS = ['신규등록', '재고이동', '상태변경', '수량조정'];

const LEDGER_HEADERS = ['물품명', '시리얼번호', '관리유형', '위치', '수량', '상태', '최종수정일'];
const LOG_HEADERS = ['타임스탬프', '작업유형', '물품명', '시리얼번호', '관리유형', '수량',
                     '출발위치', '도착위치', '출발지_이동후재고', '도착지_이동후재고', '상태', '메모'];

function SS()          { return SpreadsheetApp.getActiveSpreadsheet(); }
function toast(m, t)   { SS().toast(m, t || '📦 인벤토리', 5); }
function getOrCreate(n){ return SS().getSheetByName(n) || SS().insertSheet(n); }

// ----- 메뉴 & 트리거 -----
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 인벤토리')
    .addItem('⚙️ 초기 설정(시트 생성)', 'setup')
    .addSeparator()
    .addItem('🔍 물품 조회', 'lookupItem')
    .addItem('✅ 편집 적용', 'applyEdit')
    .addItem('🔄 폼 초기화', 'clearForm')
    .addSeparator()
    .addItem('📊 마스터 새로고침', 'rebuildMaster')
    .addItem('🧪 샘플 데이터 넣기', 'loadSample')
    .addToUI();
}

/** 물품명(B3)·시리얼(B4)을 바꾸면 자동으로 현재고를 조회해 보여준다. */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    const sh = e.range.getSheet();
    if (sh.getName() !== SHEETS.EDIT) return;
    const a1 = e.range.getA1Notation();
    if (a1 === 'B3' || a1 === 'B4') lookupItem();
  } catch (err) { /* 조용히 무시 */ }
}

// ============================================================================
//  초기 설정
// ============================================================================
function setup() {
  const ledger = getOrCreate(SHEETS.LEDGER);
  const lists  = getOrCreate(SHEETS.LISTS);
  const log    = getOrCreate(SHEETS.LOG);
  const edit   = getOrCreate(SHEETS.EDIT);
  getOrCreate(SHEETS.MASTER);

  // 재고원장(숨김)
  setHeaders(ledger, LEDGER_HEADERS);
  ledger.getRange('E2:E').setNumberFormat('0');
  ledger.getRange('G2:G').setNumberFormat('yyyy-mm-dd hh:mm');
  dvColumn(ledger, 3, MGMT);
  dvColumn(ledger, 6, STATUS);
  ledger.hideSheet();

  // 목록(숨김)
  lists.getRange('A1:B1').setValues([['물품명', '위치']]).setFontWeight('bold');
  refreshLists();
  lists.hideSheet();

  // 이동로그
  setHeaders(log, LOG_HEADERS);
  log.getRange('A2:A').setNumberFormat('yyyy-mm-dd hh:mm');
  log.setColumnWidths(1, LOG_HEADERS.length, 120);

  // 물품편집 폼
  buildEditForm(edit);

  // 마스터
  rebuildMaster();

  // 기본 'Sheet1'/'시트1' 정리
  ['Sheet1', '시트1'].forEach(function (n) {
    const s = SS().getSheetByName(n);
    if (s && s.getLastRow() === 0) SS().deleteSheet(s);
  });

  reorder();
  SS().setActiveSheet(SS().getSheetByName(SHEETS.EDIT));
  toast('초기 설정 완료 ✅  메뉴에서 사용을 시작하세요.');
}

function setHeaders(sh, headers) {
  sh.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function reorder() {
  const order = [SHEETS.MASTER, SHEETS.EDIT, SHEETS.LOG, SHEETS.LEDGER, SHEETS.LISTS];
  order.forEach(function (n, i) {
    const s = SS().getSheetByName(n);
    if (s) { SS().setActiveSheet(s); SS().moveActiveSheet(i + 1); }
  });
}

// ----- 데이터 유효성(드롭다운) 헬퍼 -----
function dv(range, list) {
  range.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
}
function dvColumn(sh, col, list) {
  sh.getRange(2, col, 1000, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build());
}
function dvFromList(range, sheetName, rangeA1, allowInvalid) {
  const src = getOrCreate(sheetName).getRange(rangeA1);
  range.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(src, true).setAllowInvalid(!!allowInvalid).build());
}

// ============================================================================
//  물품편집 폼 구성
// ============================================================================
function buildEditForm(sh) {
  sh.clear();
  sh.getRange('A1').setValue('📦 물품 추가 / 편집').setFontSize(14).setFontWeight('bold');

  const rows = [
    ['작업유형',            ''],
    ['물품명',              ''],
    ['시리얼번호',          ''],
    ['관리유형',            ''],
    ['출발위치(현재)',      ''],
    ['도착위치(이동 시)',   ''],
    ['수량',                ''],
    ['상태(변경 전/대상)',  ''],
    ['상태(변경 후)',       ''],
    ['메모',                ''],
  ];
  sh.getRange(2, 1, rows.length, 2).setValues(rows);
  sh.getRange(2, 1, rows.length, 1).setFontWeight('bold').setBackground('#eceff1');
  sh.getRange(2, 2, rows.length, 1)
    .setBackground('#fffde7')
    .setBorder(true, true, true, true, true, true);
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 260);

  // 드롭다운
  dv(sh.getRange('B2'), ACTIONS);                                 // 작업유형
  dvFromList(sh.getRange('B3'), SHEETS.LISTS, 'A2:A', true);      // 물품명(신규 입력 허용)
  dv(sh.getRange('B5'), MGMT);                                    // 관리유형
  dvFromList(sh.getRange('B6'), SHEETS.LISTS, 'B2:B', true);      // 출발위치(신규 입력 허용)
  dvFromList(sh.getRange('B7'), SHEETS.LISTS, 'B2:B', true);      // 도착위치
  dv(sh.getRange('B9'), STATUS);                                  // 상태(변경 전)
  dv(sh.getRange('B10'), STATUS);                                 // 상태(변경 후)
  sh.getRange('B8').setNumberFormat('0');                         // 수량

  // 사용법 안내
  sh.getRange('D2:F11').merge()
    .setValue(
      '■ 작업유형별 필요한 값\n' +
      '• 신규등록 : 물품명·관리유형·(시리얼 또는 수량)·출발위치·상태(변경전)\n' +
      '• 재고이동 : 물품명·관리유형·출발위치·도착위치·(시리얼 또는 수량)·상태(변경전=옮길 상태)\n' +
      '• 상태변경 : 물품명·관리유형·출발위치·(시리얼 또는 수량)·상태(변경전→변경후)\n' +
      '• 수량조정 : 물품명·수량관리·출발위치·수량(실사 최종값)·상태(변경전)\n\n' +
      '■ 적용 방법\n' +
      '  값 입력 → 메뉴 📦인벤토리 ▸ ✅편집 적용  (또는 [편집 적용] 버튼)\n' +
      '  물품명을 고르면 아래에 현재고·이력이 자동 표시됩니다.')
    .setVerticalAlignment('top').setWrap(true).setBackground('#f5f5f5');

  // 조회 결과 영역
  sh.getRange('A13').setValue('📋 조회 결과 (선택 물품의 현재고)').setFontWeight('bold');
  sh.getRange(14, 1, 1, 6)
    .setValues([['시리얼번호', '관리유형', '위치', '수량', '상태', '최종수정일']])
    .setFontWeight('bold').setBackground('#cfd8dc');
}

// ============================================================================
//  재고원장 접근 헬퍼
// ============================================================================
function scanLedger() {
  const sh = getOrCreate(SHEETS.LEDGER);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 7).getValues().map(function (r, i) {
    return {
      row: i + 2,
      name: String(r[0]).trim(),
      serial: String(r[1]).trim(),
      mgmt: r[2],
      loc: String(r[3]).trim(),
      qty: Number(r[4]) || 0,
      status: r[5],
      updated: r[6],
    };
  }).filter(function (d) { return d.name || d.serial; });
}

function findSerial(data, serial) {
  const s = String(serial).trim();
  return data.find(function (d) { return d.mgmt === '시리얼관리' && d.serial === s; });
}

/** (물품명+위치+상태) 버킷을 delta 만큼 증감. 반환값 = 변경 후 수량. */
function upsertBucket(name, loc, status, delta) {
  const led = getOrCreate(SHEETS.LEDGER);
  const data = scanLedger();
  const b = data.find(function (d) {
    return d.mgmt === '수량관리' && d.name === name && d.loc === loc && d.status === status;
  });
  const now = new Date();
  if (b) {
    const nq = b.qty + delta;
    if (nq <= 0) { led.deleteRow(b.row); return 0; }
    led.getRange(b.row, 5).setValue(nq);
    led.getRange(b.row, 7).setValue(now);
    return nq;
  }
  if (delta <= 0) return 0;
  led.appendRow([name, '', '수량관리', loc, delta, status, now]);
  return delta;
}

function logMove(o) {
  getOrCreate(SHEETS.LOG).appendRow([
    new Date(), o.type, o.name, o.serial || '', o.mgmt || '',
    (o.qty === undefined ? '' : o.qty),
    o.from || '', o.to || '',
    (o.remFrom === undefined ? '' : o.remFrom),
    (o.remTo === undefined ? '' : o.remTo),
    o.status || '', o.memo || '',
  ]);
}

// ============================================================================
//  편집 적용 (메뉴 / 버튼에서 호출)
// ============================================================================
function readForm(sh) {
  return {
    action:   sh.getRange('B2').getValue(),
    name:     String(sh.getRange('B3').getValue()).trim(),
    serial:   String(sh.getRange('B4').getValue()).trim(),
    mgmt:     sh.getRange('B5').getValue(),
    from:     String(sh.getRange('B6').getValue()).trim(),
    to:       String(sh.getRange('B7').getValue()).trim(),
    qty:      Number(sh.getRange('B8').getValue()) || 0,
    statFrom: sh.getRange('B9').getValue() || '정상',
    statTo:   sh.getRange('B10').getValue() || '정상',
    memo:     String(sh.getRange('B11').getValue()).trim(),
  };
}

function validateForm(f) {
  if (!f.action) throw new Error('작업유형을 선택하세요.');
  if (!f.name)   throw new Error('물품명을 입력하세요.');
  if (!f.mgmt)   throw new Error('관리유형을 선택하세요.');
  if (f.mgmt === '시리얼관리' && f.action !== '수량조정' && !f.serial)
    throw new Error('시리얼관리 물품은 시리얼번호가 필요합니다.');
}

function applyEdit() {
  const sh = SS().getSheetByName(SHEETS.EDIT);
  const f = readForm(sh);
  try {
    validateForm(f);
    switch (f.action) {
      case '신규등록': doRegister(f); break;
      case '재고이동': doMove(f);     break;
      case '상태변경': doStatus(f);   break;
      case '수량조정': doAdjust(f);   break;
      default: throw new Error('알 수 없는 작업유형: ' + f.action);
    }
    refreshLists();
    rebuildMaster();
    lookupItem();
    toast('✅ 적용 완료: ' + f.action);
  } catch (err) {
    safeAlert('⛔ 오류', err.message);
  }
}

function doRegister(f) {
  const led = getOrCreate(SHEETS.LEDGER);
  const loc = f.from || '미지정';
  const st  = f.statFrom || '정상';
  if (f.mgmt === '시리얼관리') {
    if (findSerial(scanLedger(), f.serial))
      throw new Error('이미 존재하는 시리얼번호입니다: ' + f.serial);
    led.appendRow([f.name, f.serial, '시리얼관리', loc, 1, st, new Date()]);
    logMove({ type: '입고', name: f.name, serial: f.serial, mgmt: f.mgmt, qty: 1, to: loc, remTo: 1, status: st, memo: f.memo });
  } else {
    if (f.qty <= 0) throw new Error('수량은 1 이상이어야 합니다.');
    const nq = upsertBucket(f.name, loc, st, f.qty);
    logMove({ type: '입고', name: f.name, mgmt: f.mgmt, qty: f.qty, to: loc, remTo: nq, status: st, memo: f.memo });
  }
}

function doMove(f) {
  if (!f.from || !f.to) throw new Error('출발위치와 도착위치를 모두 입력하세요.');
  if (f.from === f.to)  throw new Error('출발지와 도착지가 같습니다.');
  const led = getOrCreate(SHEETS.LEDGER);
  if (f.mgmt === '시리얼관리') {
    const s = findSerial(scanLedger(), f.serial);
    if (!s) throw new Error('없는 시리얼번호입니다: ' + f.serial);
    if (s.loc !== f.from)
      throw new Error('시리얼 ' + f.serial + '의 현재 위치는 \'' + s.loc + '\' 입니다. 출발지를 확인하세요.');
    led.getRange(s.row, 4).setValue(f.to);
    led.getRange(s.row, 7).setValue(new Date());
    logMove({ type: '이동', name: s.name, serial: f.serial, mgmt: f.mgmt, qty: 1,
              from: f.from, to: f.to, remFrom: 0, remTo: 1, status: s.status, memo: f.memo });
  } else {
    if (f.qty <= 0) throw new Error('이동 수량은 1 이상이어야 합니다.');
    const st = f.statFrom || '정상';
    const from = scanLedger().find(function (d) {
      return d.mgmt === '수량관리' && d.name === f.name && d.loc === f.from && d.status === st;
    });
    if (!from || from.qty < f.qty)
      throw new Error('출발지 재고 부족: \'' + f.from + '\' ' + st + ' 현재 ' + (from ? from.qty : 0) + '개');
    const remFrom = upsertBucket(f.name, f.from, st, -f.qty);
    const remTo   = upsertBucket(f.name, f.to,   st,  f.qty);
    logMove({ type: '이동', name: f.name, mgmt: f.mgmt, qty: f.qty,
              from: f.from, to: f.to, remFrom: remFrom, remTo: remTo, status: st, memo: f.memo });
  }
}

function doStatus(f) {
  const led = getOrCreate(SHEETS.LEDGER);
  if (f.mgmt === '시리얼관리') {
    const s = findSerial(scanLedger(), f.serial);
    if (!s) throw new Error('없는 시리얼번호입니다: ' + f.serial);
    const to = f.statTo || '정상';
    led.getRange(s.row, 6).setValue(to);
    led.getRange(s.row, 7).setValue(new Date());
    logMove({ type: '상태변경', name: s.name, serial: f.serial, mgmt: f.mgmt, qty: 1,
              to: s.loc, status: s.status + '→' + to, memo: f.memo });
  } else {
    if (!f.from) throw new Error('상태를 변경할 위치(출발위치)를 입력하세요.');
    if (f.qty <= 0) throw new Error('상태변경 수량은 1 이상이어야 합니다.');
    const from = f.statFrom, to = f.statTo;
    if (!from || !to || from === to) throw new Error('변경 전/후 상태를 서로 다르게 선택하세요.');
    const b = scanLedger().find(function (d) {
      return d.mgmt === '수량관리' && d.name === f.name && d.loc === f.from && d.status === from;
    });
    if (!b || b.qty < f.qty)
      throw new Error('\'' + f.from + '\'의 ' + from + ' 재고 부족: 현재 ' + (b ? b.qty : 0) + '개');
    upsertBucket(f.name, f.from, from, -f.qty);
    const nq = upsertBucket(f.name, f.from, to, f.qty);
    logMove({ type: '상태변경', name: f.name, mgmt: f.mgmt, qty: f.qty,
              to: f.from, remTo: nq, status: from + '→' + to, memo: f.memo });
  }
}

function doAdjust(f) {
  const led = getOrCreate(SHEETS.LEDGER);
  const loc = f.from || '미지정';
  if (f.mgmt === '시리얼관리') {
    const s = findSerial(scanLedger(), f.serial);
    if (!s) throw new Error('없는 시리얼번호입니다: ' + f.serial);
    if (f.qty <= 0) {
      led.deleteRow(s.row);
      logMove({ type: '수량조정', name: s.name, serial: f.serial, mgmt: f.mgmt, qty: 0,
                from: s.loc, remFrom: 0, status: '폐기', memo: f.memo });
    } else {
      toast('시리얼 물품 수량은 항상 1입니다. (변경 없음)');
    }
  } else {
    const st = f.statFrom || '정상';
    const b = scanLedger().find(function (d) {
      return d.mgmt === '수량관리' && d.name === f.name && d.loc === loc && d.status === st;
    });
    const old = b ? b.qty : 0;
    const target = f.qty;
    upsertBucket(f.name, loc, st, target - old);
    logMove({ type: '수량조정', name: f.name, mgmt: f.mgmt, qty: target - old,
              to: loc, remTo: target, status: st, memo: (f.memo ? f.memo + ' ' : '') + '(실사 ' + old + '→' + target + ')' });
  }
}

// ============================================================================
//  조회 / 초기화
// ============================================================================
function lookupItem() {
  const sh = SS().getSheetByName(SHEETS.EDIT);
  const name   = String(sh.getRange('B3').getValue()).trim();
  const serial = String(sh.getRange('B4').getValue()).trim();

  // 이전 결과 영역(15행 이하) 정리
  sh.getRange(15, 1, Math.max(sh.getMaxRows() - 15, 1), 6).clearContent();
  if (!name && !serial) return;

  const data = scanLedger().filter(function (d) {
    return (name ? d.name === name : true) && (serial ? d.serial === serial : true);
  });

  if (!data.length) { sh.getRange(15, 1).setValue('(재고 없음)'); return; }

  const rows = data.map(function (d) { return [d.serial, d.mgmt, d.loc, d.qty, d.status, d.updated]; });
  sh.getRange(15, 1, rows.length, 6).setValues(rows);
  sh.getRange(15, 6, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');

  const total = data.reduce(function (s, d) { return s + d.qty; }, 0);
  const totalRow = 15 + rows.length + 1;
  sh.getRange(totalRow, 1).setValue('총 수량').setFontWeight('bold');
  sh.getRange(totalRow, 4).setValue(total).setFontWeight('bold');

  // 최근 변경 이력
  const histTitle = totalRow + 2;
  sh.getRange(histTitle, 1).setValue('📜 최근 변경 이력 (최신 10건)').setFontWeight('bold');
  sh.getRange(histTitle + 1, 1, 1, 6)
    .setValues([['타임스탬프', '작업', '수량', '위치(출발→도착)', '상태', '메모']])
    .setFontWeight('bold').setBackground('#cfd8dc');

  const log = getOrCreate(SHEETS.LOG);
  const ll = log.getLastRow();
  if (ll >= 2) {
    const hist = log.getRange(2, 1, ll - 1, 12).getValues()
      .filter(function (x) { return x[2] === name; })
      .slice(-10).reverse()
      .map(function (x) {
        return [x[0], x[1], x[5], (x[6] || '') + '→' + (x[7] || ''), x[10], x[11]];
      });
    if (hist.length) {
      sh.getRange(histTitle + 2, 1, hist.length, 6).setValues(hist);
      sh.getRange(histTitle + 2, 1, hist.length, 1).setNumberFormat('yyyy-mm-dd hh:mm');
    }
  }
}

function clearForm() {
  const sh = SS().getSheetByName(SHEETS.EDIT);
  sh.getRange('B2:B11').clearContent();
  sh.getRange(15, 1, Math.max(sh.getMaxRows() - 15, 1), 6).clearContent();
  toast('폼 초기화 완료');
}

// ============================================================================
//  마스터 대시보드 재생성
// ============================================================================
function rebuildMaster() {
  const m = getOrCreate(SHEETS.MASTER);
  const data = scanLedger();

  // 기존 보호 해제 후 클리어
  m.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
  m.clear();

  const locs  = [...new Set(data.map(function (d) { return d.loc; }).filter(String))].sort();
  const names = [...new Set(data.map(function (d) { return d.name; }).filter(String))].sort();

  m.getRange('A1').setValue('📊 마스터 대시보드  (자동 생성 · 편집 금지)')
    .setFontSize(14).setFontWeight('bold');
  m.getRange('A2').setValue('최종 갱신: ' +
    Utilities.formatDate(new Date(), SS().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm'));

  const header = ['물품명', '관리유형'].concat(locs).concat(['총합', '정상', '고장', '수리중']);
  m.getRange(4, 1, 1, header.length).setValues([header])
    .setFontWeight('bold').setBackground('#37474f').setFontColor('#ffffff');

  const body = names.map(function (n) {
    const rowsFor = data.filter(function (d) { return d.name === n; });
    const mgmt = rowsFor[0].mgmt;
    const locCounts = locs.map(function (l) {
      return rowsFor.filter(function (d) { return d.loc === l; })
                    .reduce(function (s, d) { return s + d.qty; }, 0);
    });
    const total = rowsFor.reduce(function (s, d) { return s + d.qty; }, 0);
    const st = function (s) {
      return rowsFor.filter(function (d) { return d.status === s; })
                    .reduce(function (a, d) { return a + d.qty; }, 0);
    };
    return [n, mgmt].concat(locCounts).concat([total, st('정상'), st('고장'), st('수리중')]);
  });

  if (body.length) {
    m.getRange(5, 1, body.length, header.length).setValues(body);
    // 합계 행
    const L = locs.length;
    const sumCol = function (idx) { return body.reduce(function (s, r) { return s + r[idx]; }, 0); };
    const totalsRow = ['합계', ''];
    for (let i = 0; i < L; i++) totalsRow.push(sumCol(2 + i));
    totalsRow.push(sumCol(2 + L), sumCol(3 + L), sumCol(4 + L), sumCol(5 + L));
    m.getRange(5 + body.length, 1, 1, header.length).setValues([totalsRow])
      .setFontWeight('bold').setBackground('#eceff1');
  } else {
    m.getRange(5, 1).setValue('(등록된 물품이 없습니다. 물품편집 시트에서 신규등록 하세요.)');
  }

  m.setFrozenRows(4);
  m.setFrozenColumns(2);
  m.autoResizeColumns(1, header.length);

  // 편집 금지 보호
  const p = m.protect().setDescription('마스터 대시보드 - 자동생성, 편집금지');
  p.removeEditors(p.getEditors());
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

// ----- 드롭다운 목록 갱신 -----
function refreshLists() {
  const lists = getOrCreate(SHEETS.LISTS);
  const data = scanLedger();
  const names = [...new Set(data.map(function (d) { return d.name; }).filter(String))].sort();
  const locs  = [...new Set(data.map(function (d) { return d.loc; }).filter(String))].sort();
  lists.getRange('A2:A').clearContent();
  lists.getRange('B2:B').clearContent();
  if (names.length) lists.getRange(2, 1, names.length, 1).setValues(names.map(function (n) { return [n]; }));
  if (locs.length)  lists.getRange(2, 2, locs.length, 1).setValues(locs.map(function (l) { return [l]; }));
}

// ----- 유틸 -----
function safeAlert(title, msg) {
  try { SpreadsheetApp.getUi().alert(title + '\n\n' + msg); }
  catch (e) { toast(msg, title); }
}

// ----- 샘플 데이터 -----
function loadSample() {
  const led = getOrCreate(SHEETS.LEDGER);
  const now = new Date();
  const rows = [
    ['노트북 ThinkPad X1', 'SN-LT-001', '시리얼관리', '본사창고', 1, '정상', now],
    ['노트북 ThinkPad X1', 'SN-LT-002', '시리얼관리', '강릉지사', 1, '고장', now],
    ['노트북 ThinkPad X1', 'SN-LT-003', '시리얼관리', '본사창고', 1, '정상', now],
    ['A4 복사용지',        '',          '수량관리',   '본사창고', 50, '정상', now],
    ['A4 복사용지',        '',          '수량관리',   '강릉지사', 20, '정상', now],
    ['무선 마우스',        '',          '수량관리',   '본사창고', 15, '정상', now],
    ['무선 마우스',        '',          '수량관리',   '본사창고',  2, '고장', now],
  ];
  led.getRange(led.getLastRow() + 1, 1, rows.length, 7).setValues(rows);
  refreshLists();
  rebuildMaster();
  toast('샘플 데이터 로드 완료 🧪');
}
