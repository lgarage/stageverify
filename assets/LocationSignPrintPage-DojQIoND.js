import{Ir as e,Mr as t,Pr as n,Rr as r,kn as i,kr as a,r as o,yr as s}from"./index-C3JsB7Gu.js";import{a as c,i as l,r as u,t as d}from"./PortalSidebar-C0z8NlbB.js";import{t as f}from"./EslQrCode-Bk4p9SQf.js";var p=r(e(),1),m=s(),h=`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;function g(e){let t=e?.trim()??``;return t?i(t):``}function _(){let[e,r]=n(),i=t(),s=(0,p.useMemo)(()=>g(e.get(`loc`)),[e]),_=s?o(s,{forPrint:!0}):``,v=(0,p.useCallback)(()=>{window.print()},[]);return(0,m.jsxs)(`div`,{style:{fontFamily:h},className:c,children:[(0,m.jsx)(d,{className:`print:hidden`}),(0,m.jsxs)(`div`,{className:u,style:{backgroundColor:`#e5e7eb`},children:[(0,m.jsxs)(`div`,{className:`${l} print:hidden`,style:{padding:`24px 30px`,backgroundColor:`#e5e7eb`},children:[(0,m.jsxs)(`div`,{style:{maxWidth:720,margin:`0 auto`,display:`flex`,flexWrap:`wrap`,alignItems:`center`,gap:12},children:[(0,m.jsx)(`button`,{type:`button`,onClick:()=>i(-1),style:{padding:`8px 14px`,borderRadius:4,border:`1px solid #64748b`,backgroundColor:`#fff`,color:`#334155`,fontWeight:600,fontSize:13,cursor:`pointer`},children:`Back`}),(0,m.jsx)(a,{to:`/zones`,style:{fontSize:13,fontWeight:600,color:`#0a3161`},children:`Staging Map`}),(0,m.jsxs)(`form`,{onSubmit:e=>{e.preventDefault();let t=new FormData(e.currentTarget),n=g(String(t.get(`loc`)??``));n&&r({loc:n},{replace:!0})},style:{display:`flex`,gap:8,flex:`1 1 200px`},children:[(0,m.jsxs)(`label`,{style:{display:`flex`,alignItems:`center`,gap:6},children:[(0,m.jsx)(`span`,{style:{fontSize:13,fontWeight:600,color:`#374151`},children:`Spot`}),(0,m.jsx)(`input`,{name:`loc`,defaultValue:s,placeholder:`G1`,"data-testid":`location-sign-loc-input`,style:{padding:`8px 10px`,borderRadius:4,border:`1px solid #cbd5e1`,fontSize:14,fontWeight:700,color:`#111`,backgroundColor:`#fff`,width:96}})]}),(0,m.jsx)(`button`,{type:`submit`,style:{padding:`8px 14px`,borderRadius:4,border:`1px solid #0a3161`,backgroundColor:`#fff`,color:`#0a3161`,fontWeight:700,fontSize:13,cursor:`pointer`},children:`Preview`})]}),(0,m.jsx)(`button`,{type:`button`,"data-testid":`location-sign-print-button`,disabled:!s,onClick:v,style:{padding:`10px 20px`,borderRadius:4,border:`none`,backgroundColor:s?`#0a3161`:`#94a3b8`,color:`#fff`,fontWeight:700,fontSize:14,cursor:s?`pointer`:`not-allowed`,marginLeft:`auto`},children:`Print label`})]}),(0,m.jsx)(`p`,{style:{maxWidth:720,margin:`12px auto 0`,fontSize:12,color:`#64748b`},children:`US Letter portrait — one sign per sheet. QR encodes the permanent scan URL for this spot (never changes when occupancy changes).`})]}),(0,m.jsx)(`div`,{style:{padding:`24px 30px 48px`,display:`flex`,justifyContent:`center`,backgroundColor:`#e5e7eb`},className:`location-sign-print-stage`,children:s?(0,m.jsxs)(`div`,{"data-testid":`location-sign-print-sheet`,"data-permanent-url":_,className:`location-sign-print-sheet`,style:{boxSizing:`border-box`,width:`100%`,maxWidth:`7.5in`,minHeight:`9.5in`,margin:`0 auto`,padding:`0.55in 0.5in`,backgroundColor:`#fff`,border:`4px solid #000`,display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,gap:`0.35in`,color:`#000`},children:[(0,m.jsx)(`div`,{"data-testid":`location-sign-code`,style:{fontSize:`clamp(72px, 18vw, 140px)`,fontWeight:900,lineHeight:1,letterSpacing:`-0.03em`,color:`#000`,textAlign:`center`},children:s}),(0,m.jsx)(`div`,{style:{padding:12,border:`3px solid #000`,backgroundColor:`#fff`,lineHeight:0},children:(0,m.jsx)(f,{value:_,variant:`print`,size:280})}),(0,m.jsx)(`div`,{"data-testid":`location-sign-arrow`,"aria-hidden":!0,style:{fontSize:`clamp(48px, 12vw, 96px)`,fontWeight:900,lineHeight:1,color:`#000`},children:`↓`})]}):(0,m.jsx)(`p`,{className:`print:hidden`,style:{fontSize:14,color:`#64748b`,textAlign:`center`},children:`Enter a spot code (e.g. G1) to preview the printable sign.`})})]}),(0,m.jsx)(`style`,{children:`
        @media print {
          @page {
            size: letter portrait;
            margin: 0.45in;
          }
          .print\\:hidden { display: none !important; }
          html, body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .portal-shell,
          .portal-main,
          .portal-scroll {
            display: block !important;
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .location-sign-print-stage {
            padding: 0 !important;
            background: #fff !important;
          }
          .location-sign-print-sheet {
            width: 100% !important;
            max-width: none !important;
            min-height: auto !important;
            height: auto !important;
            margin: 0 !important;
            border: 4px solid #000 !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }
        }
      `})]})}export{_ as LocationSignPrintPage};