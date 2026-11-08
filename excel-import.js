'use strict';
/* Aspria 0.2 Excel reader. Reads a user-selected .xlsx locally; no network or upload.
   Supports the user's ledger: B4:B16 account labels, C3 onward monthly headers, row 4-16 balances.
   JSZip 3.10.1 is included locally under MIT license. */
window.AspriaExcel = (() => {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  const MAX_XML_BYTES = 12 * 1024 * 1024;
  function elements(root, local) {return [...root.getElementsByTagNameNS('*', local)];}
  function first(root, local) {return elements(root, local)[0] || null;}
  function parseXML(s) {
    s=s.replace(/^\uFEFF/,'');
    if (s.length > MAX_XML_BYTES) throw Error('Excelの内部データが大きすぎます。');
    const xml = new DOMParser().parseFromString(s,'application/xml');
    if (xml.getElementsByTagName('parsererror').length) throw Error('ExcelのXMLを読み取れませんでした。');
    return xml;
  }
  function excelColumnIndex(column) {
    let n=0;
    for(const ch of column.toUpperCase()) n=n*26+ch.charCodeAt(0)-64;
    return n;
  }
  function excelColumnName(index) {
    let res='';
    while(index>0){ index--; res=String.fromCharCode(65+index%26)+res; index=Math.floor(index/26); }
    return res;
  }
  function safeEntry(zip, name, allowAbsent=false) {
    const item=zip.file(name);
    if(!item){if(allowAbsent)return null;throw Error(`Excelの内部ファイル ${name} が見つかりません。`);}
    const size=item._data?.uncompressedSize;
    if(size && size>MAX_XML_BYTES) throw Error('Excelの内部データが大きすぎます。');
    return item;
  }
  async function readXML(zip, name, optional=false) {
    const f=safeEntry(zip,name,optional);
    return f ? parseXML(await f.async('string')) : null;
  }
  function cellString(cell, shared) {
    const typ=cell.getAttribute('t')||'';
    if(typ==='inlineStr')return elements(first(cell,'is')||cell,'t').map(x=>x.textContent).join('');
    const raw=first(cell,'v')?.textContent;
    if(raw==null || raw==='') return '';
    if(typ==='s'){
      const index=Number(raw);
      if(!Number.isInteger(index)||index<0||index>=shared.length)throw Error('文字列テーブルの参照が不正です。');
      return shared[index];
    }
    return raw;
  }
  function excelSerialMonth(n) {
    const unix=Math.round((n-25569)*86400000);
    const d=new Date(unix);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  }
  function parseHeader(value) {
    if(typeof value==='number' && value>30000 && value<100000) return {month:Number(excelSerialMonth(value).slice(5)),year:Number(excelSerialMonth(value).slice(0,4))};
    const str=String(value).trim().replace(/\s+/g,'');
    if(/^\d{5}$/.test(str)&&Number(str)>30000&&Number(str)<100000){const date=excelSerialMonth(Number(str));return {month:Number(date.slice(5)),year:Number(date.slice(0,4))};}
    let m=str.match(/^(\d{4})[年/\-.](\d{1,2})(?:月|(?:[\/-]?e))?$/i);
    if(m){ const year=Number(m[1]), month=Number(m[2]); if(month>=1&&month<=12)return {month,year}; }
    m=str.match(/^(\d{1,2})(?:月|\/e|\/E|\/|\s*)$/);
    if(m){const month=Number(m[1]);if(month>=1&&month<=12)return {month,year:null};}
    if(typeof value==='number'&&value>=1&&value<=12&&Number.isInteger(value))return {month:value,year:null};
    return null;
  }
  function monthString(y,m) {return `${y}-${String(m).padStart(2,'0')}`;}
  function resolveMonths(headers, start) {
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(start))throw Error('最初の記録年月を指定してください。');
    const result=[];
    let lastMonth=0, year=Number(start.slice(0,4));
    for(let i=0;i<headers.length;i++){
      const parsed=parseHeader(headers[i]);
      if(!parsed)throw Error(`${excelColumnName(i+3)}3 の見出し「${headers[i]}」から月を判定できません。`);
      if(i===0){ if(parsed.month!==Number(start.slice(5)))throw Error(`最初の列は${parsed.month}月です。開始年月をその月に合わせてください。`); }
      else if(parsed.year!=null){year=parsed.year;}
      else if(parsed.month<lastMonth){year++;}
      else if(parsed.month===lastMonth)throw Error(`${excelColumnName(i+3)}3 の月が前列と重複しています。`);
      if(parsed.year!=null)year=parsed.year;
      const val=monthString(year,parsed.month);
      if(result.length && val<=result.at(-1))throw Error('月の並びが正しくありません。Excelの見出しを確認してください。');
      result.push(val); lastMonth=parsed.month;
    }
    if(!result.length)throw Error('3行目に月の見出しがありません。');
    return result;
  }
  function parseBalance(raw, address, formula=false) {
    const s=String(raw).trim();
    if(!s){if(formula)throw Error(`${address} の数式の計算結果を取得できません。Excelで計算して保存してください。`);return null;}
    const clean=s.replace(/[¥￥円,，\s]/g,'');
    if(!/^(?:0|\d+(?:\.0+)?)$/.test(clean))throw Error(`${address} の残高「${s}」は読み込めません。0以上の整数（円）で指定してください。`);
    const num=Number(clean);
    if(!Number.isSafeInteger(num))throw Error(`${address} の金額が大きすぎます。`);
    return num;
  }
  async function readWorkbook(file) {
    if(!file || !/\.xlsx$/i.test(file.name))throw Error('Excel（.xlsx）ファイルを選択してください。');
    if(file.size>MAX_FILE_BYTES)throw Error('8MB以下のExcelファイルを選択してください。');
    if(!window.JSZip)throw Error('Excel読込ライブラリを読み込めません。再読み込みしてください。');
    const zip=await window.JSZip.loadAsync(await file.arrayBuffer());
    if(Object.keys(zip.files).length>2500)throw Error('Excel内部のファイル数が多すぎます。');
    const wb=await readXML(zip,'xl/workbook.xml');
    const rels=await readXML(zip,'xl/_rels/workbook.xml.rels');
    const sheets=elements(wb,'sheet');
    if(!sheets.length)throw Error('Excelにシートがありません。');
    const sheet=sheets[0], relId=sheet.getAttributeNS(REL_NS,'id')||sheet.getAttribute('r:id');
    const rel=elements(rels,'Relationship').find(x=>x.getAttribute('Id')===relId);
    if(!rel)throw Error('シートの参照を確認できません。');
    const target=rel.getAttribute('Target')||'';
    if(rel.getAttribute('TargetMode')==='External' || target.includes('..') || target.includes('://'))throw Error('外部参照には対応していません。');
    const normalized=target.startsWith('/')?target.slice(1):(target.startsWith('xl/')?target:'xl/'+target);
    const sheetXML=await readXML(zip,normalized);
    const sharedXML=await readXML(zip,'xl/sharedStrings.xml',true);
    const shared=sharedXML?elements(sharedXML,'si').map(si=>elements(si,'t').map(t=>t.textContent).join('')):[];
    const grid=new Map(), formulas=new Set();
    for(const cell of elements(sheetXML,'c')){
      const address=cell.getAttribute('r')?.toUpperCase();
      if(!address || !/^[A-Z]+\d+$/.test(address))continue;
      if(first(cell,'f'))formulas.add(address);
      grid.set(address,cellString(cell,shared));
    }
    const rows=[];
    for(let n=4;n<=16;n++){
      const name=String(grid.get(`B${n}`)||'').trim();
      if(!name){
        // Blank rows are permitted; accidental filled values on unnamed rows are not.
        if([...grid.keys()].some(k=>/^[A-Z]+\d+$/.test(k) && Number(k.match(/\d+$/)[0])===n && excelColumnIndex(k.match(/^[A-Z]+/)[0])>=3 && String(grid.get(k)).trim()))throw Error(`B${n} に口座名がありません。`);
        continue;
      }
      if(name.length>80)throw Error(`B${n} の口座名が長すぎます。`);
      rows.push({excelRow:n,name,values:[]});
    }
    if(!rows.length)throw Error('B4～B16に口座名が見つかりません。');
    if(new Set(rows.map(r=>r.name)).size!==rows.length)throw Error('B4～B16に同じ口座名があります。口座名を区別してください。');
    const headers=[],columns=[];
    for(let col=3;col<=502;col++){
      const header=String(grid.get(`${excelColumnName(col)}3`)||'').trim();
      if(!header){
        if(rows.some(r=>String(grid.get(`${excelColumnName(col)}${r.excelRow}`)||'').trim()))throw Error(`${excelColumnName(col)}3 に記録月がありません。`);
        continue;
      }
      headers.push(header);columns.push(col);
    }
    if(!headers.length)throw Error('C3以降に記録月が見つかりません。');
    if(headers.length>480)throw Error('読み込む月数が多すぎます。');
    let amounts=0, missing=0;
    for(const row of rows){
      for(const col of columns){
        const address=`${excelColumnName(col)}${row.excelRow}`;
        const amount=parseBalance(grid.get(address)||'',address,formulas.has(address));
        row.values.push(amount);
        if(amount===null)missing++;else amounts++;
      }
    }
    return {fileName:file.name,sheetName:sheet.getAttribute('name')||'Sheet1',headers,columns,rows,amounts,missing};
  }
  return {readWorkbook,resolveMonths};
})();
