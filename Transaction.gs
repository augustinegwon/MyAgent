/**
 * Generates the Input UI
 */
function setupInputSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let inputSheet = ss.getSheetByName('Input_Transaction');
  
  if (!inputSheet) {
    inputSheet = ss.insertSheet('Input_Transaction', 0);
  } else {
    inputSheet.clear();
  }
  
  // --- [Left Panel: Item Search] ---
  inputSheet.getRange('B2:C2').merge().setValue('🔍 Item Search').setBackground('#4a86e8').setFontColor('white').setFontWeight('bold');
  inputSheet.getRange('B3').setValue('Category');
  inputSheet.getRange('C3').setBackground('#fff2cc'); 
  inputSheet.getRange('B4').setValue('Item');
  inputSheet.getRange('C4').setBackground('#fff2cc'); 
  inputSheet.getRange('B6:C6').setValues([['Location', 'Current Qty']]).setFontWeight('bold').setBackground('#f3f3f3');
  
  // Real-time stock formula (수량열 H, 출발F, 도착G 반영)
  inputSheet.getRange('B7').setFormula(
    `=IFERROR(LET(item, $C$4, buckets, TOCOL(LIST_BUCKET, 1, TRUE), balances, BYROW(buckets, LAMBDA(b, SUMIFS(Ledger!$H:$H, Ledger!$D:$D, item, Ledger!$G:$G, b) - SUMIFS(Ledger!$H:$H, Ledger!$D:$D, item, Ledger!$F:$F, b))), FILTER({buckets, balances}, balances <> 0)), "Item not selected or out of stock.")`
  );

  // --- [Right Panel: Transaction Form] ---
  inputSheet.getRange('E2:F2').merge().setValue('📦 Transaction Form').setBackground('#34495e').setFontColor('white').setFontWeight('bold');
  
  const formLabels = [
    ['Type', 'ADD'], 
    ['Item', '=$C$4'], 
    ['Serial No.', 'N/A'], // F5 셀 (시리얼 넘버 칸 추가)
    ['From', ''], 
    ['To', ''],   
    ['Quantity', 1],
    ['Worker', ''],
    ['Note', '']
  ];
  inputSheet.getRange('E3:F10').setValues(formLabels);
  
  inputSheet.getRange('E3:E10').setBackground('#f3f3f3').setFontWeight('bold');
  inputSheet.getRange('F3:F10').setBackground('#fff2cc'); 
  inputSheet.getRange('F4').setBackground('#e1e1e1').setFontColor('#7f8c8d');
  inputSheet.getRange('F5').setBackground('#e1e1e1').setFontColor('#7f8c8d'); // 초기값은 잠금 상태

  // --- [Helper Columns W, Y, Z] ---
  // ★ W열: (핵심!) 선택한 아이템이 From(F7) 위치에 존재하는 특정 시리얼만 필터링하는 수식
  inputSheet.getRange('W1').setFormula(
    `=IFERROR(UNIQUE(FILTER(TOCOL(LIST_BUCKET, 1, TRUE), BYROW(TOCOL(LIST_BUCKET, 1, TRUE), LAMBDA(b, SUMIFS(Ledger!$H:$H, Ledger!$D:$D, $C$4, Ledger!$G:$G, b) - SUMIFS(Ledger!$H:$H, Ledger!$D:$D, $C$4, Ledger!$F:$F, b))) > 0)), "")`
  );
  inputSheet.hideColumns(23); // W열 숨김
  
  // ★ X열: (추가할 부분) 현재 위치(From)에 존재하는 해당 아이템의 시리얼만 필터링
  inputSheet.getRange('X1').setFormula(
    `=IFERROR(LET(i, $C$4, loc, $F$6, sers, UNIQUE(FILTER(Ledger!E:E, (Ledger!D:D=i)*(Ledger!E:E<>"")*(Ledger!E:E<>"N/A"))), bals, BYROW(sers, LAMBDA(s, SUMIFS(Ledger!H:H, Ledger!D:D, i, Ledger!E:E, s, Ledger!G:G, loc) - SUMIFS(Ledger!H:H, Ledger!D:D, i, Ledger!E:E, s, Ledger!F:F, loc))), FILTER(sers, bals>0)), "")`
  );
  inputSheet.hideColumns(24); // X열 숨김
  
  // Y열: Location TOCOL
  inputSheet.getRange('Y1').setFormula(`=IFERROR(TOCOL(LIST_BUCKET, 1, TRUE), "")`);
  inputSheet.hideColumns(25); // Y열 숨김

  // Z열: Dependent Item
  inputSheet.getRange('Z1').setFormula(`=IFERROR(IF(C3="", FILTER(LIST_ITEM, LIST_ITEM<>""), FILTER(LIST_ITEM, LIST_CATEGORY=C3, LIST_ITEM<>"")), "")`);
  inputSheet.hideColumns(26); // Z열 숨김

  // --- [Data Validations] ---
  const categoryRule = SpreadsheetApp.newDataValidation().requireValueInRange(ss.getRange('LIST_CATEGORY')).build();
  inputSheet.getRange('C3').setDataValidation(categoryRule);
  const itemRule = SpreadsheetApp.newDataValidation().requireValueInRange(inputSheet.getRange('Z1:Z')).build();
  inputSheet.getRange('C4').setDataValidation(itemRule);
  const typeRule = SpreadsheetApp.newDataValidation().requireValueInList(['ADD', 'MOVE', 'REMOVE']).build();
  inputSheet.getRange('F3').setDataValidation(typeRule);
  const bucketRule = SpreadsheetApp.newDataValidation().requireValueInRange(inputSheet.getRange('Y1:Y')).setAllowInvalid(false).build();
  inputSheet.getRange('F6').setDataValidation(bucketRule);
  inputSheet.getRange('F7').setDataValidation(bucketRule);
  const qtyRule = SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).build();
  inputSheet.getRange('F8').setDataValidation(qtyRule);
  
  inputSheet.setColumnWidth(1, 30);
  inputSheet.setColumnWidth(2, 110);
  inputSheet.setColumnWidth(3, 180);
  inputSheet.setColumnWidth(4, 50);
  inputSheet.setColumnWidth(5, 110);
  inputSheet.setColumnWidth(6, 200);
}

/**
 * Transaction Submit
 */
function submitTransaction() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName('Input_Transaction');
  const ledgerSheet = ss.getSheetByName('Ledger');
  
  const type = inputSheet.getRange('F3').getValue();
  const itemName = inputSheet.getRange('F4').getValue(); 
  let serial = inputSheet.getRange('F5').getValue();
  let fromLoc = inputSheet.getRange('F6').getValue();
  let toLoc = inputSheet.getRange('F7').getValue();
  let quantity = inputSheet.getRange('F8').getValue();
  const worker = inputSheet.getRange('F9').getValue();
  const note = inputSheet.getRange('F10').getValue();
  
  if (!type || !itemName || !quantity) {
    ss.toast('❌ Error: Type, Item, and Quantity are required.', 'Validation Error', 5);
    return;
  }
  
  // Manage Serial 유무 확인
  const settingsSheet = ss.getSheetByName('Settings');
  const mapping = settingsSheet.getRange('B2:C' + settingsSheet.getLastRow()).getValues();
  let category = 'UNCATEGORIZED';
  let isSerial = 'NO';
  
  for (let i = 0; i < mapping.length; i++) {
    if (mapping[i][0] === itemName) {
      isSerial = mapping[i][1];
      break;
    }
  }
  
  // Category 찾기 (A열)
  const catData = settingsSheet.getRange('A2:B' + settingsSheet.getLastRow()).getValues();
  for (let i = 0; i < catData.length; i++) {
    if (catData[i][1] === itemName) {
      category = catData[i][0];
      break;
    }
  }

  if (isSerial === 'YES') {
    if (!serial || serial === 'N/A') {
      ss.toast('❌ Error: Serial Number is required for this item.', 'Validation Error', 5);
      return;
    }
    quantity = 1; // 시리얼 관리는 무조건 수량 1 고정
  } else {
    serial = 'N/A'; // 시리얼 관리 안 하는 항목은 N/A
  }
  
  if (type === 'ADD' && !fromLoc) fromLoc = 'EXTERNAL (VENDOR)';
  if (type === 'REMOVE' && !toLoc) toLoc = 'EXTERNAL (SCRAP)';
  if (!fromLoc || !toLoc) {
    ss.toast(`❌ Error: 'From' and 'To' locations must be valid.`, 'Validation Error', 5);
    return;
  }
  
  // Ledger에 기록!
  ledgerSheet.appendRow([
    new Date(), type, category, itemName, serial, fromLoc, toLoc, quantity, worker, note
  ]);
  
  // 폼 초기화
  inputSheet.getRange('F3').setValue('ADD');
  inputSheet.getRange('F5').setValue(isSerial === 'YES' ? '' : 'N/A');
  inputSheet.getRange('F6:F7').clearContent();
  inputSheet.getRange('F8').setValue(isSerial === 'YES' ? 1 : 1);
  inputSheet.getRange('F9:F10').clearContent();
  
  // UI 갱신 함수 강제 호출 (초기화 후 회색으로 잠그기 위해)
  updateDynamicUI(ss, inputSheet);
  
  ss.toast(`✅ [${type}] Transaction recorded successfully!`, 'Success', 3);
}

/**
 * OnEdit Trigger (대문자 변환 + 동적 UI 업데이트)
 */
function onEdit(e) {
  if (!e) return;
  const range = e.range;
  const sheet = range.getSheet();
  const sheetName = sheet.getName();

  // 1. 대문자 자동 변환 (전체 시트)
  const excludeSheets = ['Dashboard', 'Ledger']; 
  if (!excludeSheets.includes(sheetName)) {
    const values = range.getValues();
    const formulas = range.getFormulas();
    let isChanged = false;
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        if (formulas[r][c] !== "") continue;
        const val = values[r][c];
        if (typeof val === 'string' && /[a-z]/.test(val)) {
          values[r][c] = val.toUpperCase();
          isChanged = true;
        }
      }
    }
    if (isChanged) range.setValues(values);
  }
  
  // 2. 동적 UI 제어 (Input_Transaction 시트에서 특정 셀 건드릴 때만 발동)
  if (sheetName === 'Input_Transaction') {
    const r = range.getRow();
    const c = range.getColumn();
    // Type(F3), Item(C4), Category(C3), From(F6)이 변경될 때 UI 업데이트
    if ((r === 3 && c === 3) || (r === 4 && c === 3) || (r === 3 && c === 6) || (r === 6 && c === 6)) {
      updateDynamicUI(e.source, sheet);
    }
  }
}

/**
 * 동적으로 Serial 필드와 Qty 필드의 드롭다운 및 색상을 제어하는 함수
 */
function updateDynamicUI(ss, inputSheet) {
  const type = inputSheet.getRange('F3').getValue();
  const itemName = inputSheet.getRange('C4').getValue(); 
  const serialCell = inputSheet.getRange('F5');
  const fromLocCell = inputSheet.getRange('F6'); // From 셀
  const qtyCell = inputSheet.getRange('F8');

  // 아이템 시리얼 여부 확인
  const settingsSheet = ss.getSheetByName('Settings');
  const mapping = settingsSheet.getRange('B2:C' + settingsSheet.getLastRow()).getValues();
  let isSerial = 'NO';
  for (let i = 0; i < mapping.length; i++) {
    if (mapping[i][0] === itemName) {
      isSerial = mapping[i][1];
      break;
    }
  }

  // ★ From 드롭다운 동적 제어: 재고가 0보다 큰 위치만 필터링
  // W열 수식을 활용해 재고 > 0 인 위치만 추출하도록 설정
  const locRule = SpreadsheetApp.newDataValidation()
    .requireValueInRange(inputSheet.getRange('W1:W')) 
    .setAllowInvalid(false).build();
  
  if (type === 'MOVE' || type === 'REMOVE') {
    fromLocCell.setDataValidation(locRule); // 재고 있는 위치만 표시
  } else {
    fromLocCell.clearDataValidations(); // ADD 시에는 전체 위치 표시
  }

  // 기존 시리얼/수량 제어 로직
  if (isSerial === 'YES') {
    qtyCell.setValue(1);
    qtyCell.setBackground('#e1e1e1').setFontColor('#7f8c8d');
    if (type === 'ADD') {
      serialCell.clearDataValidations();
      serialCell.setBackground('#fff2cc');
    } else {
      // MOVE/REMOVE 시: 해당 아이템의 현재 시리얼만 드롭다운
      const serialRule = SpreadsheetApp.newDataValidation().requireValueInRange(inputSheet.getRange('X1:X')).build();
      serialCell.setDataValidation(serialRule);
      serialCell.setBackground('#fff2cc');
    }
  } else {
    serialCell.setValue('N/A');
    serialCell.setBackground('#e1e1e1');
    qtyCell.setBackground('#fff2cc').setFontColor('black');
  }
}
