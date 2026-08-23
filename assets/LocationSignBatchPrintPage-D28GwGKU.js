import{Ga as e,Ja as t,Qa as n,_r as r,eo as i,h as a,ht as o,ki as s,t as c,wt as l,x as u}from"./index-BRphnDam.js";import{r as d,t as f}from"./stagingMapSync-BpJVB-7O.js";import{t as p}from"./EslQrCode-WJ9HmV99.js";import{a as m,i as h,n as g,o as _,r as v,t as y}from"./LocationSignPrintSheet-Bpxk32da.js";var b=i(n(),1),x=`Catch-All`;function S(e,t){return d(e,{catchAllStagingLocationId:t})}function C(e,t,n){let r=t?.trim()||void 0;return S(f(e,n??{}),r)}function w(e,t){let n=t?.trim();return n&&e.id===n?!0:s(e.mapLayoutSlot??e.code)===s(`CA`)}var T=r(),E=8;function D(e,t){let n=[];for(let r=0;r<e.length;r+=t)n.push(e.slice(r,r+t));return n}function O({entry:e}){if(!e)return(0,T.jsx)(`div`,{className:`location-sign-2x4-label location-sign-2x4-label--blank`,"data-testid":`location-sign-2x4-label`,"data-blank":`true`,"aria-hidden":!0});let t=m(e.locationCode),n=e.headlineText?.trim()||t,r=t?u(t,{forPrint:!0}):``;return t?(0,T.jsxs)(`div`,{className:`location-sign-2x4-label`,"data-testid":`location-sign-2x4-label`,"data-location-code":t,"data-sign-headline":n,"data-permanent-url":r,children:[(0,T.jsx)(`div`,{className:n===`Catch-All`?`location-sign-2x4-label-code location-sign-2x4-label-code--catch-all`:`location-sign-2x4-label-code`,"data-testid":`location-sign-code`,children:n}),(0,T.jsx)(`div`,{className:`location-sign-2x4-label-qr`,children:(0,T.jsx)(p,{value:r,variant:`print`,size:144})})]}):null}function k({entries:e,pageIndex:t,totalPages:n}){let r=[...e];for(;r.length<E;)r.push(null);let i=[];for(let e=0;e<4;e++)i.push([r[e*2]??null,r[e*2+1]??null]);return(0,T.jsx)(`div`,{className:`location-sign-2x4-page location-sign-print-sheet--batch`,"data-testid":`location-sign-2x4-page`,"data-page-index":t,"data-page-count":n,children:(0,T.jsx)(`div`,{className:`location-sign-2x4-letter`,children:(0,T.jsx)(`div`,{className:`location-sign-2x4-block`,children:i.map((e,t)=>(0,T.jsxs)(`div`,{className:`location-sign-2x4-row-wrap`,children:[t>0?(0,T.jsx)(`div`,{className:`location-sign-2x4-row-gutter`,"aria-hidden":!0}):null,(0,T.jsxs)(`div`,{className:`location-sign-2x4-row`,children:[(0,T.jsx)(O,{entry:e[0]}),(0,T.jsx)(`div`,{className:`location-sign-2x4-col-gutter`,"aria-hidden":!0}),(0,T.jsx)(O,{entry:e[1]})]})]},t))})})})}function A({entries:e}){if(e.length===0)return null;let t=D(e,E);return(0,T.jsx)(T.Fragment,{children:t.map((e,n)=>(0,T.jsx)(k,{entries:e,pageIndex:n,totalPages:t.length},`2x4-page-${n}`))})}var j=`
  .location-sign-2x4-letter {
    box-sizing: border-box;
    min-height: 11in;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    margin: 0;
  }
  .location-sign-2x4-block {
    position: relative;
    box-sizing: border-box;
  }
  .location-sign-2x4-block::before {
    content: "";
    position: absolute;
    left: calc(4in + 0.125in);
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px dotted #000;
    pointer-events: none;
    z-index: 2;
  }
  .location-sign-2x4-row {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    justify-content: flex-start;
    flex-shrink: 0;
    width: calc(4in + 0.25in + 4in);
    box-sizing: border-box;
  }
  .location-sign-2x4-col-gutter {
    flex: 0 0 0.25in;
    width: 0.25in;
    min-width: 0.25in;
    flex-shrink: 0;
  }
  .location-sign-2x4-row-gutter {
    width: calc(4in + 0.25in + 4in);
    height: 0.125in;
    margin: 0 auto;
    border-bottom: 1px dotted #000;
    box-sizing: content-box;
    padding-bottom: 0.125in;
  }
  .location-sign-2x4-label {
    position: relative;
    top: 0.125in;
    box-sizing: border-box;
    flex: 0 0 4in;
    flex-shrink: 0;
    width: 4in;
    min-width: 4in;
    height: 2in;
    border: 2px solid #000;
    background: #fff;
    color: #000;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    column-gap: 0.06in;
    padding: 0.25in 0.25in 0.25in 0;
    overflow: hidden;
  }
  .location-sign-2x4-label--blank {
    border-color: transparent;
    background: transparent;
  }
  .location-sign-2x4-label-code {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: clamp(36px, 8vw, 72px);
    font-weight: 900;
    line-height: 1.05;
    letter-spacing: -0.03em;
    color: #000;
    text-align: center;
  }
  .location-sign-2x4-label-code--catch-all {
    font-size: clamp(36px, 8vw, 72px);
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .location-sign-2x4-label-qr {
    flex-shrink: 0;
    line-height: 0;
    background: #fff;
  }

  @media print {
    .location-sign-2x4-row,
    .location-sign-2x4-label,
    .location-sign-2x4-col-gutter {
      flex-shrink: 0 !important;
    }
    .location-sign-2x4-page {
      break-after: page;
      page-break-after: always;
    }
    .location-sign-2x4-page:last-child {
      break-after: auto;
      page-break-after: auto;
    }
    .location-sign-print-page[data-batch-label-size="label2x4"] .location-sign-2x4-page {
      page: label2x4;
    }
  }
`,M=`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,N=`#0a3161`,P=`#facc15`,F=`#111827`;function I({active:e,testId:t,label:n,onClick:r}){return(0,T.jsxs)(`button`,{type:`button`,"data-testid":t,"aria-pressed":e,onClick:r,style:{display:`inline-flex`,alignItems:`center`,gap:6,padding:`6px 12px`,borderRadius:4,border:`2px solid ${e?`#ca8a04`:`#64748b`}`,backgroundColor:e?P:`#fff`,color:e?F:`#334155`,fontWeight:700,fontSize:12,cursor:`pointer`},children:[e?(0,T.jsx)(`span`,{"aria-hidden":!0,style:{fontSize:14,lineHeight:1},children:`✓`}):null,n]})}function L(){let n=t(),[r,i]=(0,b.useState)([]),[s,u]=(0,b.useState)(void 0),[d,f]=(0,b.useState)(()=>new Set),[p,S]=(0,b.useState)(`full`),[E,D]=(0,b.useState)(!0),[O,k]=(0,b.useState)(null);(0,b.useEffect)(()=>{let e=!1;return D(!0),k(null),Promise.all([l(),o()]).then(([t,n])=>{if(e)return;let r=n.catchAllStagingLocationId?.trim()||void 0;u(r),i(C(t,r,n.shopMapLayoutExtras??{})),f(new Set)}).catch(t=>{e||(k(t instanceof Error?t.message:`Failed to load zones`),i([]),f(new Set))}).finally(()=>{e||D(!1)}),()=>{e=!0}},[]);let P=(0,b.useMemo)(()=>r.filter(e=>d.has(e.id)),[r,d]),F=(0,b.useMemo)(()=>P.map(e=>m(e.code)).filter(e=>e.length>0),[P]),L=(0,b.useMemo)(()=>{let e=[];for(let t of P){let n=m(t.code);if(!n)continue;let r=w(t,s);e.push({locationCode:n,...r?{headlineText:x}:{}})}return e},[P,s]);_(F.length>0?`Labels (${F.length})`:` `);let R=(0,b.useCallback)(e=>{f(t=>{let n=new Set(t);return n.has(e)?n.delete(e):n.add(e),n})},[]),z=(0,b.useCallback)(()=>{f(new Set(r.map(e=>e.id)))},[r]),B=(0,b.useCallback)(()=>{f(new Set)},[]),V=(0,b.useCallback)(()=>{window.print()},[]),H=E?`Loading spots…`:O||(p===`full`?`${d.size} of ${r.length} selected — one US Letter page each`:`${d.size} of ${r.length} selected — 8 labels per US Letter page`),U=d.size>0;return(0,T.jsxs)(c,{style:{fontFamily:M},forceLight:!0,children:[(0,T.jsx)(a,{className:`print:hidden`}),(0,T.jsxs)(`div`,{className:g,"data-batch-label-size":p,style:{backgroundColor:`#e5e7eb`},children:[(0,T.jsxs)(`div`,{className:`location-sign-print-toolbar print:hidden`,"data-testid":`location-sign-print-toolbar`,style:{padding:`24px 30px`,backgroundColor:`#e5e7eb`},children:[(0,T.jsxs)(`div`,{style:{maxWidth:960,margin:`0 auto`,display:`flex`,flexWrap:`wrap`,alignItems:`center`,gap:12},children:[(0,T.jsx)(`button`,{type:`button`,onClick:()=>n(-1),style:{padding:`8px 14px`,borderRadius:4,border:`1px solid #64748b`,backgroundColor:`#fff`,color:`#334155`,fontWeight:600,fontSize:13,cursor:`pointer`},children:`Back`}),(0,T.jsx)(e,{to:`/zones`,style:{fontSize:13,fontWeight:600,color:N},children:`Staging Map`}),(0,T.jsx)(`p`,{"data-testid":`location-sign-batch-summary`,style:{margin:0,fontSize:13,fontWeight:600,color:`#374151`,flex:`1 1 200px`},children:H}),(0,T.jsx)(`button`,{type:`button`,"data-testid":`location-sign-batch-print-button`,disabled:E||!!O||d.size===0,onClick:V,style:{padding:`10px 20px`,borderRadius:4,border:`none`,backgroundColor:!E&&!O&&d.size>0?N:`#94a3b8`,color:`#fff`,fontWeight:700,fontSize:14,cursor:!E&&!O&&d.size>0?`pointer`:`not-allowed`,marginLeft:`auto`},children:`Print selected labels`})]}),!E&&!O&&r.length>0?(0,T.jsxs)(`div`,{"data-testid":`location-sign-batch-picker`,style:{maxWidth:960,margin:`16px auto 0`,padding:`12px 14px`,backgroundColor:`#fff`,borderRadius:6,border:`1px solid #cbd5e1`},children:[(0,T.jsxs)(`div`,{style:{display:`flex`,flexWrap:`wrap`,alignItems:`center`,gap:10,marginBottom:10},children:[(0,T.jsx)(`span`,{style:{fontSize:13,fontWeight:700,color:`#111827`},children:`Choose labels to print`}),(0,T.jsx)(`button`,{type:`button`,"data-testid":`location-sign-batch-select-all`,onClick:z,style:{padding:`6px 12px`,borderRadius:4,border:`1px solid ${N}`,backgroundColor:`#fff`,color:N,fontWeight:600,fontSize:12,cursor:`pointer`},children:`Select all`}),(0,T.jsx)(`button`,{type:`button`,"data-testid":`location-sign-batch-clear-all`,onClick:B,style:{padding:`6px 12px`,borderRadius:4,border:`1px solid #64748b`,backgroundColor:`#fff`,color:`#334155`,fontWeight:600,fontSize:12,cursor:`pointer`},children:`Clear all`}),(0,T.jsx)(I,{testId:`location-sign-size-full`,label:`Full page`,active:p===`full`,onClick:()=>S(`full`)}),(0,T.jsx)(I,{testId:`location-sign-size-2x4`,label:`2" x 4" Label`,active:p===`label2x4`,onClick:()=>S(`label2x4`)})]}),(0,T.jsx)(`ul`,{"data-testid":`location-sign-batch-picker-list`,style:{listStyle:`none`,margin:0,padding:0,maxHeight:220,overflowY:`auto`,display:`grid`,gridTemplateColumns:`repeat(auto-fill, minmax(140px, 1fr))`,gap:6},children:r.map(e=>{let t=m(e.code),n=w(e,s),r=d.has(e.id);return(0,T.jsx)(`li`,{children:(0,T.jsxs)(`label`,{"data-testid":`location-sign-batch-picker-row`,"data-zone-id":e.id,"data-location-code":t,"data-catch-all":n?`true`:`false`,style:{display:`flex`,alignItems:`center`,gap:8,padding:`6px 8px`,borderRadius:4,cursor:`pointer`,backgroundColor:r?`#eff6ff`:`#f9fafb`,border:`1px solid ${r?`#93c5fd`:`#e5e7eb`}`,fontSize:13,color:`#111827`,fontWeight:600},children:[(0,T.jsx)(`input`,{type:`checkbox`,checked:r,onChange:()=>R(e.id),"data-testid":`location-sign-batch-picker-checkbox`,style:{width:16,height:16,accentColor:N}}),(0,T.jsx)(`span`,{children:t||e.code}),n?(0,T.jsx)(`span`,{"data-testid":`location-sign-batch-catch-all-badge`,style:{fontSize:10,fontWeight:700,textTransform:`uppercase`,letterSpacing:`0.04em`,color:N,marginLeft:`auto`},children:`Catch-all`}):null]})},e.id)})})]}):null,(0,T.jsxs)(`p`,{"data-testid":`location-sign-print-hint`,style:{maxWidth:960,margin:`10px auto 0`,fontSize:12,color:`#64748b`,lineHeight:1.4},children:[`Select spots above, choose a size, then print. Full-page sheets match the single-spot sign layout. `,y]})]}),!E&&!O&&r.length===0?(0,T.jsx)(`p`,{className:`print:hidden`,style:{fontSize:14,color:`#64748b`,textAlign:`center`,padding:24},children:`No spots available to print.`}):null,!E&&!O&&r.length>0&&!U?(0,T.jsx)(`p`,{className:`print:hidden`,"data-testid":`location-sign-batch-none-selected`,style:{fontSize:14,color:`#64748b`,textAlign:`center`,padding:24},children:`Select at least one label above to print.`}):null,U?(0,T.jsx)(`div`,{"data-testid":`location-sign-batch-stage`,className:`location-sign-print-stage location-sign-print-stage--screen-hidden${p===`label2x4`?` location-sign-print-stage--2x4`:``}`,children:p===`full`?P.map(e=>{let t=w(e,s);return(0,T.jsx)(h,{locationCode:m(e.code),headlineText:t?x:void 0,batchPreviewGap:!0},e.id)}):(0,T.jsx)(A,{entries:L})}):null]}),(0,T.jsx)(`style`,{children:v}),(0,T.jsx)(`style`,{children:j})]})}export{L as LocationSignBatchPrintPage};