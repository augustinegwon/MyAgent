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

  // 2. Ledger Sheet (Transaction Log)
  let ledgerSheet = ss.getSheetByName('Ledger');
  if (!ledgerSheet) {
    ledgerSheet = ss.insertSheet('Ledger');
    
    // 헤더 추가: Serial Number (E열 추가됨)
    const ledgerHeaders = ['Timestamp', 'Type', 'Category', 'Item', 'Serial Number', 'From', 'To', 'Quantity', 'Worker', 'Note'];
    ledgerSheet.getRange(1, 1, 1, ledgerHeaders.length).setValues([ledgerHeaders]);
    ledgerSheet.getRange(1, 1, 1, ledgerHeaders.length).setFontWeight('bold').setBackground('#e8f4f8');
    ledgerSheet.setFrozenRows(1);
  }

  // 3. Dashboard Sheet (Matrix View)
  let viewSheet = ss.getSheetByName('Dashboard');
  if (!viewSheet) {
    viewSheet = ss.insertSheet('Dashboard');
    
    viewSheet.getRange('A1').setValue('📊 [Inventory Matrix]').setFontWeight('bold').setFontSize(12);
    
    // Y-Axis: Items
    viewSheet.getRange('A3').setFormula(`=FILTER(LIST_ITEM, LIST_ITEM<>"")`);
    // X-Axis: Buckets (Locations)
    viewSheet.getRange('B2').setFormula(`=IFERROR(TRANSPOSE(TOCOL(LIST_BUCKET, 1, TRUE)), "")`);
    // Matrix Body: 시리얼 번호가 추가되어 수량 열이 G->H, From이 E->F, To가 F->G로 밀린 것을 반영한 수식
    viewSheet.getRange('B3').setFormula(
      `=IFERROR(LET(items, FILTER(LIST_ITEM, LIST_ITEM<>""), buckets, TOCOL(LIST_BUCKET, 1, TRUE), MAKEARRAY(ROWS(items), ROWS(buckets), LAMBDA(r, c, LET(i, INDEX(items, r), b, INDEX(buckets, c), SUMIFS(Ledger!$H:$H, Ledger!$D:$D, i, Ledger!$G:$G, b) - SUMIFS(Ledger!$H:$H, Ledger!$D:$D, i, Ledger!$F:$F, b))))), "")`
    );
  }

  // 4. Named Ranges
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
