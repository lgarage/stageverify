import{Br as e,Rr as t,kn as n,r,xr as i}from"./index-bdK9dog5.js";import{r as a}from"./PortalSidebar-CWki3385.js";import{t as o}from"./EslQrCode-DDuWOUC-.js";var s=e(t(),1),c=i();function l(e){let t=e?.trim()??``;return t?n(t):``}var u=`${a} location-sign-print-page`,d=`In the print dialog, turn off Headers and footers for a clean sign-only page.`,f=`stageverify`;function p(e){(0,s.useEffect)(()=>{let t=e.trim()||` `,n=()=>{document.title=t},r=()=>{document.title=f};return window.addEventListener(`beforeprint`,n),window.addEventListener(`afterprint`,r),()=>{window.removeEventListener(`beforeprint`,n),window.removeEventListener(`afterprint`,r),document.title=f}},[e])}var m=`
  .location-sign-print-page {
    overflow-x: hidden;
    overflow-y: auto !important;
  }
  .location-sign-print-toolbar {
    flex-shrink: 0;
  }

  @media print {
    @page {
      size: letter portrait;
      margin: 0.45in;
    }
    .print\\:hidden,
    .portal-sidebar,
    .portal-topbar,
    [data-testid="dispatcher-portal-topbar"],
    .location-sign-print-toolbar,
    [data-testid="location-sign-print-hint"] {
      display: none !important;
    }
    html, body, #root {
      background: #fff !important;
      margin: 0 !important;
      padding: 0 !important;
      height: auto !important;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .portal-shell,
    .location-sign-print-page {
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
      margin: 0 !important;
      background: #fff !important;
    }
    .location-sign-print-stage > :not(.location-sign-print-sheet) {
      display: none !important;
    }
    .location-sign-print-sheet {
      width: 100% !important;
      max-width: none !important;
      min-height: auto !important;
      height: auto !important;
      margin: 0 !important;
      border: 2px solid #000 !important;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .location-sign-print-sheet--batch {
      break-after: page;
      page-break-after: always;
    }
    .location-sign-print-sheet--batch:last-child {
      break-after: auto;
      page-break-after: auto;
    }
  }
`;function h({locationCode:e,headlineText:t,batchPreviewGap:n=!1}){let i=l(e),a=t?.trim()||i,s=i?r(i,{forPrint:!0}):``;return i?(0,c.jsxs)(`div`,{"data-testid":`location-sign-print-sheet`,"data-location-code":i,"data-sign-headline":a,"data-permanent-url":s,className:`location-sign-print-sheet${n?` location-sign-print-sheet--batch`:``}`,style:{boxSizing:`border-box`,width:`100%`,maxWidth:`7.5in`,minHeight:`9.5in`,margin:n?`0 auto 32px`:`0 auto`,padding:`0.55in 0.5in`,backgroundColor:`#fff`,border:`2px solid #000`,display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`center`,gap:`0.28in`,color:`#000`},children:[(0,c.jsx)(`div`,{"data-testid":`location-sign-code`,style:{fontSize:`clamp(80px, 20vw, 168px)`,fontWeight:900,lineHeight:1,letterSpacing:`-0.04em`,color:`#000`,textAlign:`center`},children:a}),(0,c.jsx)(`div`,{style:{padding:8,border:`2px solid #000`,backgroundColor:`#fff`,lineHeight:0},children:(0,c.jsx)(o,{value:s,variant:`print`,size:280})}),(0,c.jsx)(`div`,{"data-testid":`location-sign-scan-caption`,style:{fontSize:`clamp(14px, 2.2vw, 20px)`,fontWeight:800,letterSpacing:`0.14em`,textTransform:`uppercase`,color:`#000`,textAlign:`center`,lineHeight:1.2},children:`SCAN FOR STATUS`}),(0,c.jsx)(`div`,{"data-testid":`location-sign-arrow`,"aria-hidden":!0,style:{display:`flex`,justifyContent:`center`,lineHeight:0},children:(0,c.jsx)(`svg`,{viewBox:`0 0 64 96`,width:`clamp(72px, 14vw, 120px)`,height:`clamp(96px, 18vw, 144px)`,role:`presentation`,"data-testid":`location-sign-arrow-svg`,children:(0,c.jsx)(`path`,{d:`M32 88 L56 56 L44 56 L44 8 L20 8 L20 56 L8 56 Z`,fill:`#000`})})})]}):null}export{l as a,h as i,u as n,p as o,m as r,d as t};