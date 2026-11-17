/* CRM «Работа»: компактные настройки ручных WhatsApp-сообщений клиентам. */
"use strict";
(function(root){
  const wa=()=>root.__rdClientWhatsApp;
  const create=(tag,cls,text)=>{
    const e=document.createElement(tag);if(cls)e.className=cls;
    if(text!==undefined)e.textContent=text;return e;
  };
  let nextId=0;
  const mounted=[];
  function mount(target){
    if(!target||target.querySelector(".wa-settings-root"))return;
    if(!wa())return;
    const id=++nextId;
    const rootBox=create("div","wa-settings-root");
    const entry=create("button","wa-settings-entry");
    entry.type="button";entry.setAttribute("aria-expanded","false");
    const icon=create("span","wa-settings-symbol","▣");icon.setAttribute("aria-hidden","true");
    const copy=create("span","wa-settings-entry-copy");
    copy.append(create("strong","","WhatsApp"),create("small","","Тексты при записи и завершении заказа"));
    entry.append(icon,copy,create("span","wa-settings-chevron","›"));
    const editor=create("section","wa-settings-editor");
    editor.id="wa-settings-editor-"+id;editor.hidden=true;
    entry.setAttribute("aria-controls",editor.id);
    const back=create("button","wa-settings-back","‹ Назад к настройкам");back.type="button";
    editor.append(back,create("h2","wa-settings-heading","WhatsApp · сообщения клиентам"),
      create("p","wa-settings-intro",
        "Измени текст один раз. При создании и закрытии заказа он подставится в WhatsApp автоматически. Отправка остаётся ручной."));
    const tokenNames={имя:"Имя",дата:"Дата",время:"Время",мастер:"Мастер",адрес:"Адрес",ссылка:"Ссылка на отзыв"};
    const sample={name:"Александр",phone:"+7 900 000-00-00",date:"2026-11-20",time:"12:00",master:"Рауль",address:"Владикавказ"};
    const forms={};
    function createTemplate(kind,title,description,keys){
      const area=create("section","wa-template-card");
      const header=create("h3","",title);
      const note=create("p","wa-settings-hint",description);
      const label=create("label","wa-settings-label","Текст сообщения");
      const field=create("textarea","wa-settings-textarea");
      field.rows=kind==="booking"?9:8;field.maxLength=2500;
      field.id="wa-template-"+kind+"-"+id;label.htmlFor=field.id;
      const tokens=create("div","wa-template-tokens");
      for(const key of keys){
        const chip=create("button","wa-template-chip","{"+tokenNames[key]+"}");
        chip.type="button";chip.title="Вставить {"+key+"}";
        chip.addEventListener("click",()=>{
          const start=field.selectionStart??field.value.length,end=field.selectionEnd??start;
          const token="{"+key+"}";
          field.value=field.value.slice(0,start)+token+field.value.slice(end);
          field.focus();field.setSelectionRange(start+token.length,start+token.length);
          refreshPreview();
        });
        tokens.append(chip);
      }
      const previewTitle=create("div","wa-settings-preview-title","Как увидит клиент");
      const preview=create("pre","wa-settings-preview");
      area.append(header,note,label,field,tokens,previewTitle,preview);
      editor.append(area);forms[kind]={field,preview};
      field.addEventListener("input",refreshPreview);
    }
    createTemplate("booking","После создания заказа",
      "Подтверждение с датой, временем и мастером.",
      ["имя","дата","время","мастер","адрес"]);
    createTemplate("review","После завершения заказа",
      "Благодарность и просьба оставить отзыв.",
      ["имя","ссылка"]);
    const urlField=create("input","wa-settings-url");
    urlField.id="wa-review-url-"+id;urlField.type="url";urlField.inputMode="url";
    urlField.placeholder="https://...";urlField.autocomplete="off";
    const urlLabel=create("label","wa-settings-label","Ссылка на отзывы (необязательно)");
    urlLabel.htmlFor=urlField.id;
    const urlNote=create("p","wa-settings-hint",
      "Если добавишь ссылку, она появится в конце сообщения или вместо поля {ссылка}.");
    editor.append(urlLabel,urlField,urlNote);
    urlField.addEventListener("input",refreshPreview);
    const buttons=create("div","wa-settings-actions");
    const save=create("button","wa-settings-save","Сохранить шаблоны");save.type="button";
    const restore=create("button","wa-settings-restore","Вернуть стандартные");restore.type="button";
    const status=create("div","wa-settings-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const locality=create("p","wa-settings-locality",
      "Настройки хранятся только на этом устройстве. На другом телефоне их нужно настроить отдельно.");
    buttons.append(save,restore);
    editor.append(buttons,status,locality);
    rootBox.append(entry,editor);target.append(rootBox);
    function values(){return {
      booking:forms.booking.field.value,review:forms.review.field.value,reviewUrl:urlField.value
    };}
    function setValues(config){
      forms.booking.field.value=config.booking;forms.review.field.value=config.review;
      urlField.value=config.reviewUrl||"";
      refreshPreview();
    }
    function refreshPreview(){
      const draft=values();
      try{forms.booking.preview.textContent=wa().renderTemplate(draft.booking,sample);}
      catch(_){forms.booking.preview.textContent="Проверьте дату и текст сообщения.";}
      try{
        const url=wa().validateSettings({...wa().defaults(),...draft}).reviewUrl;
        let message=wa().renderTemplate(draft.review,sample,url);
        if(url&&!draft.review.includes("{ссылка}"))message+="\n\n"+url;
        forms.review.preview.textContent=message;
      }catch(_){forms.review.preview.textContent="Проверьте текст или ссылку.";}
    }
    function closeEditor(){
      const stored=wa().getSettings();
      if(JSON.stringify(values())!==JSON.stringify(stored)&&
          !root.confirm("Несохранённые изменения будут потеряны. Закрыть?"))return;
      editor.hidden=true;entry.hidden=false;entry.setAttribute("aria-expanded","false");
      entry.focus({preventScroll:true});
    }
    entry.addEventListener("click",()=>{
      setValues(wa().getSettings());status.textContent="";
      editor.hidden=false;entry.hidden=true;entry.setAttribute("aria-expanded","true");
      back.focus({preventScroll:true});
    });
    back.addEventListener("click",closeEditor);
    save.addEventListener("click",()=>{
      status.classList.remove("is-error");
      try{
        const stored=wa().saveSettings(values());
        setValues(stored);
        status.textContent="Сохранено. Новые сообщения будут использовать этот текст.";
      }catch(error){status.classList.add("is-error");status.textContent=error.message;}
    });
    restore.addEventListener("click",()=>{
      if(!root.confirm("Вернуть стандартные тексты? Твои изменения будут удалены."))return;
      try{
        const original=wa().saveSettings(wa().defaults());
        setValues(original);status.classList.remove("is-error");
        status.textContent="Стандартные тексты восстановлены.";
      }catch(error){status.classList.add("is-error");status.textContent=error.message;}
    });
    mounted.push({root:rootBox,refresh:()=>{
      if(editor.hidden)setValues(wa().getSettings());
    }});
  }
  root.__rdWhatsAppSettings={mount,refresh(){
    for(const item of mounted)item.refresh();
  }};
})(typeof window!=="undefined"?window:globalThis);
