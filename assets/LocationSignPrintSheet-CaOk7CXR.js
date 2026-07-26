import{Bn as e,Mr as t,Yr as n,Zr as r,r as i}from"./index-DaVC4Xs7.js";import{t as a}from"./EslQrCode-DLMHf2Fc.js";var o=r(n(),1),s=t();function c(t){let n=t?.trim()??``;return n?e(n):``}var l=`location-sign-print-page`,u=`In the print dialog, turn off Headers and footers for a clean sign-only page.`,d=`stageverify`;function f(e){(0,o.useEffect)(()=>{let t=e.trim()||` `;document.title=t;let n=()=>{document.title=t},r=()=>{document.title=d};return window.addEventListener(`beforeprint`,n),window.addEventListener(`afterprint`,r),()=>{window.removeEventListener(`beforeprint`,n),window.removeEventListener(`afterprint`,r),document.title=d}},[e])}var p=`
  .location-sign-print-page {
    flex: 1;
    min-width: 0;
    height: 100%;
    max-height: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    display: block;
    box-sizing: border-box;
  }
  .location-sign-print-toolbar {
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 5;
  }

  .location-sign-print-stage--screen-hidden {
    position: fixed;
    left: -10000px;
    top: 0;
    width: 8.5in;
    visibility: hidden;
    pointer-events: none;
    overflow: hidden;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
  }

  @media print {
    .location-sign-print-stage--screen-hidden {
      position: static !important;
      left: auto !important;
      visibility: visible !important;
      width: auto !important;
      overflow: visible !important;
      pointer-events: auto !important;
    }
  }

  @media print {
    @page {
      size: letter portrait;
      margin: 0.45in;
    }
    @page label2x4 {
      size: letter portrait;
      margin: 0;
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
    .location-sign-print-stage > :not(.location-sign-print-sheet):not(.location-sign-2x4-page) {
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
`;function m({locationCode:e,headlineText:t,batchPreviewGap:n=!1}){let r=c(e),o=t?.trim()||r,l=r?i(r,{forPrint:!0}):``;return r?(0,s.jsxs)(`div`,{"data-testid":`location-sign-print-sheet`,"data-location-code":r,"data-sign-headline":o,"data-permanent-url":l,className:`location-sign-print-sheet${n?` location-sign-print-sheet--batch`:``}`,style:{boxSizing:`border-box`,width:`100%`,maxWidth:`7.5in`,minHeight:`9.5in`,margin:n?`0 auto 32px`:`0 auto`,padding:`0.7in 0.5in 0.55in`,backgroundColor:`#fff`,border:`2px solid #000`,display:`flex`,flexDirection:`column`,alignItems:`center`,justifyContent:`flex-start`,gap:`0.28in`,color:`#000`},children:[(0,s.jsx)(`div`,{"data-testid":`location-sign-code`,style:{fontSize:`clamp(80px, 20vw, 168px)`,fontWeight:900,lineHeight:1,letterSpacing:`-0.04em`,color:`#000`,textAlign:`center`},children:o}),(0,s.jsx)(`div`,{style:{padding:8,border:`2px solid #000`,backgroundColor:`#fff`,lineHeight:0},children:(0,s.jsx)(a,{value:l,variant:`print`,size:280})}),(0,s.jsx)(`div`,{"data-testid":`location-sign-scan-caption`,style:{fontSize:`clamp(14px, 2.2vw, 20px)`,fontWeight:800,letterSpacing:`0.14em`,textTransform:`uppercase`,color:`#000`,textAlign:`center`,lineHeight:1.2},children:`SCAN FOR STATUS`}),(0,s.jsx)(`div`,{"data-testid":`location-sign-arrow`,"aria-hidden":!0,style:{display:`flex`,justifyContent:`center`,lineHeight:0},children:(0,s.jsx)(`svg`,{viewBox:`0 0 64 96`,width:`clamp(72px, 14vw, 120px)`,height:`clamp(96px, 18vw, 144px)`,role:`presentation`,"data-testid":`location-sign-arrow-svg`,children:(0,s.jsx)(`path`,{d:`M32 88 L56 56 L44 56 L44 8 L20 8 L20 56 L8 56 Z`,fill:`#000`})})})]}):null}export{c as a,m as i,l as n,f as o,p as r,u as t};