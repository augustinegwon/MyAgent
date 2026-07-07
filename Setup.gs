/**
 * 스프레드시트를 열 때 커스텀 메뉴를 생성한다.
 * (셋업과 거래 제출을 코드로 연결 — 수동 버튼 배치가 없어도 동작)
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 재고관리')
    .addItem('① 시스템 초기화 (시트 생성)', 'setupInventorySystem')
    .addItem('② 입력 시트 생성', 'setupInputSheet')
    .addSeparator()
    .addItem('📥 거래 제출 (Submit)', 'submitTransaction')
    .addToUi();
}

/**
 * System Initialization Script (Serial Number Management Included)
 */
function setupInventorySystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Settings Sheet (Master Data)
  let settingsSheet = ss.getSheetByName('Settings');
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet('Settings');
    
    // 헤더 추가: Manage Serial (C열)
    const headers = ['Category', 'Item', 'Manage Serial', '', 'Location', 'Tour Package'];
    settingsSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    settingsSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3f3f3');
    settingsSheet.setFrozenRows(1);
    
    // 샘플 데이터 (VR은 시리얼 관리 YES, 케이블은 NO)
    settingsSheet.getRange(2, 1, 2, 6).setValues([
      ['ELECTRONICS', 'VR HEADSET', 'YES', '', 'SEOUL OFFICE', 'G1 PACKAGE'],
      ['CABLE', 'TYPE-C CABLE 2M', 'NO', '', 'GIMPO WAREHOUSE', 'G2 PACKAGE']
    ]);
  }

  // 2. Initial_Inventory Sheet (최초 재고 U — 절대참조 앵커)
  //    물품 × 위치별 '시작 재고'를 최초 1회 입력하고, 이후 수정하지 않는다.
  //    (비시리얼 품목용. 시리얼 품목의 초기 재고는 Ledger의 ADD 거래로 넣는다.)
  let initSheet = ss.getSheetByName('Initial_Inventory');
  if (!initSheet) {
    initSheet = ss.insertSheet('Initial_Inventory');

    const initHeaders = ['Item', 'Location', 'Initial Qty (U)'];
    initSheet.getRange(1, 1, 1, initHeaders.length).setValues([initHeaders]);
    initSheet.getRange(1, 1, 1, initHeaders.length).setFontWeight('bold').setBackground('#fde9d9');
    initSheet.setFrozenRows(1);

    // 샘플: 비시리얼 품목(케이블)의 최초 재고
    initSheet.getRange(2, 1, 1, 3).setValues([
      ['TYPE-C CABLE 2M', 'GIMPO WAREHOUSE', 50]
    ]);

    // 수정 금지 안내(경고형 보호 — 실수 방지, 필요 시 확인 후 편집 가능)
    const protection = initSheet.protect().setDescription('최초 재고(U) — 절대참조값, 수정 금지');
    protection.setWarningOnly(true);
  }

  // 3. Ledger Sheet (Transaction Log)
  let ledgerSheet = ss.getSheetByName('Ledger');
  if (!ledgerSheet) {
    ledgerSheet = ss.insertSheet('Ledger');
    
    // 헤더 추가: Serial Number (E열 추가됨)
    const ledgerHeaders = ['Timestamp', 'Type', 'Category', 'Item', 'Serial Number', 'From', 'To', 'Quantity', 'Worker', 'Note'];
    ledgerSheet.getRange(1, 1, 1, ledgerHeaders.length).setValues([ledgerHeaders]);
    ledgerSheet.getRange(1, 1, 1, ledgerHeaders.length).setFontWeight('bold').setBackground('#e8f4f8');
    ledgerSheet.setFrozenRows(1);
  }

  // 4. Balance Sheet (집계 계층 — 단일 계산 소스)
  //    물품 × 위치별로  현재고 = U(최초) + 입고(To) - 출고(From)  을 계산한다.
  //    Check 열이 음수(<0)를 잡아내어 Ledger 오염을 감지한다.
  let balanceSheet = ss.getSheetByName('Balance');
  if (!balanceSheet) {
    balanceSheet = ss.insertSheet('Balance');

    const balHeaders = ['Item', 'Location', 'Initial (U)', 'In (입고)', 'Out (출고)', 'Current (현재고)', 'Check'];
    balanceSheet.getRange(1, 1, 1, balHeaders.length).setValues([balHeaders]);
    balanceSheet.getRange(1, 1, 1, balHeaders.length).setFontWeight('bold').setBackground('#d9ead3');
    balanceSheet.setFrozenRows(1);

    // 물품 × 위치 조합을 모두 펼쳐 7개 열을 한 번에 스필하는 배열 수식.
    balanceSheet.getRange('A2').setFormula(
      `=IFERROR(LET(` +
      `items, FILTER(LIST_ITEM, LIST_ITEM<>""), ` +
      `buckets, TOCOL(LIST_BUCKET, 1, TRUE), ` +
      `nb, ROWS(buckets), ` +
      `MAKEARRAY(ROWS(items)*nb, 7, LAMBDA(r, c, LET(` +
      `i, INDEX(items, INT((r-1)/nb)+1), ` +
      `b, INDEX(buckets, MOD(r-1, nb)+1), ` +
      `u, SUMIFS(Initial_Inventory!$C:$C, Initial_Inventory!$A:$A, i, Initial_Inventory!$B:$B, b), ` +
      `inQ, SUMIFS(Ledger!$H:$H, Ledger!$D:$D, i, Ledger!$G:$G, b), ` +
      `outQ, SUMIFS(Ledger!$H:$H, Ledger!$D:$D, i, Ledger!$F:$F, b), ` +
      `cur, u + inQ - outQ, ` +
      `IFS(c=1, i, c=2, b, c=3, u, c=4, inQ, c=5, outQ, c=6, cur, ` +
      `c=7, IF(cur<0, "⚠️ 오류(음수)", IF(cur=0, "", "OK"))))))), "")`
    );
  }

  // 5. Dashboard Sheet (Matrix View — Balance 시트를 피벗해 표시)
  let viewSheet = ss.getSheetByName('Dashboard');
  if (!viewSheet) {
    viewSheet = ss.insertSheet('Dashboard');

    viewSheet.getRange('A1').setValue('📊 [Inventory Matrix]').setFontWeight('bold').setFontSize(12);

    // Y-Axis: Items
    viewSheet.getRange('A3').setFormula(`=FILTER(LIST_ITEM, LIST_ITEM<>"")`);
    // X-Axis: Buckets (Locations)
    viewSheet.getRange('B2').setFormula(`=IFERROR(TRANSPOSE(TOCOL(LIST_BUCKET, 1, TRUE)), "")`);
    // Matrix Body: Balance 시트의 Current(현재고, F열)를 (물품×위치)로 조회한다.
    viewSheet.getRange('B3').setFormula(
      `=IFERROR(LET(items, FILTER(LIST_ITEM, LIST_ITEM<>""), buckets, TOCOL(LIST_BUCKET, 1, TRUE), MAKEARRAY(ROWS(items), ROWS(buckets), LAMBDA(r, c, SUMIFS(Balance!$F:$F, Balance!$A:$A, INDEX(items, r), Balance!$B:$B, INDEX(buckets, c))))), "")`
    );
  }

  // 6. Named Ranges
  setNamedRange(ss, 'LIST_CATEGORY', 'Settings!A2:A');
  setNamedRange(ss, 'LIST_ITEM', 'Settings!B2:B');
  setNamedRange(ss, 'LIST_BUCKET', 'Settings!E2:F'); // Location은 이제 E, F열
  
  ss.toast('✅ System setup is complete!', 'Success', 3);
}

function setNamedRange(ss, name, rangeString) {
  const namedRanges = ss.getNamedRanges();
  for (let i = 0; i < namedRanges.length; i++) {
    if (namedRanges[i].getName() === name) {
      namedRanges[i].remove();
    }
  }
  ss.setNamedRange(name, ss.getRange(rangeString));
}
