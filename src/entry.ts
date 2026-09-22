const mode=new URLSearchParams(location.search).get('mode');
if(mode==='research'){
  await import('./main.ts');
  const preview=document.getElementById('survey-mode');
  if(preview)preview.onclick=()=>{location.href=new URL(import.meta.env.BASE_URL,location.href).href;};
}else{
  await import('./participant.ts');
}
export {};
