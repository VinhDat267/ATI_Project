import { useLayoutEffect, useRef, type RefObject } from 'react';
const focusable='button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary,[tabindex="0"]';
export function useDialogFocus(ref:RefObject<HTMLElement|null>, onClose:()=>void, returnFocusId:string) {
  const close=useRef(onClose); close.current=onClose;
  useLayoutEffect(()=>{
    const opener=document.activeElement as HTMLElement|null,dialog=ref.current!;
    const items=()=>[...dialog.querySelectorAll<HTMLElement>(focusable)].filter(item=>!item.hidden && !item.closest('[hidden]'));
    items()[0]?.focus();
    const background=[...document.querySelectorAll<HTMLElement>('[data-cockpit-background]')];
    background.forEach(element=>{element.inert=true;});
    const previousOverflow=document.body.style.overflow; document.body.style.overflow='hidden';
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.current();}
      if(event.key==='Tab') {const first=items()[0],last=items().at(-1);if(!first){event.preventDefault();dialog.focus();}else if(event.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}else if(!event.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))){event.preventDefault();first.focus();}}
    };
    const focusin=(event:FocusEvent)=>{if(!dialog.contains(event.target as Node))items()[0]?.focus();};
    document.addEventListener('keydown',keydown);document.addEventListener('focusin',focusin);
    return ()=>{background.forEach(element=>{element.inert=false;});document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',keydown);document.removeEventListener('focusin',focusin);(document.getElementById(returnFocusId) ?? (opener?.isConnected ? opener : null))?.focus();};
  },[ref,returnFocusId]);
}
