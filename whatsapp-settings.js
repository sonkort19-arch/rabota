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
    const entry=create("button","wa-settings-entry rd-opening");
    entry.type="button";entry.setAttribute("aria-expanded","false");
    const icon=create("span","wa-settings-symbol");icon.setAttribute("aria-hidden","true");
    // Inline vector icon: no external font, emoji fallback, or extra network request.
    icon.innerHTML='<svg viewBox="0 0 24 24" width="24" height="24" focusable="false" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.966-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.058-.173-.297-.018-.458.13-.606.133-.133.297-.347.446-.52.149-.174.198-.298.297-.496.099-.198.05-.372-.025-.52-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.67-.51-.173-.008-.372-.01-.57-.01-.198 0-.52.075-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.077 4.487.709.306 1.262.488 1.693.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.86 9.86 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.447 4.435-9.88 9.884-9.88a9.84 9.84 0 0 1 6.99 2.894 9.84 9.84 0 0 1 2.89 6.992c-.003 5.448-4.436 9.881-9.885 9.881m8.413-18.297A11.82 11.82 0 0 0 12.008 0C5.495 0 .193 5.3.19 11.814c0 2.083.544 4.117 1.577 5.912L.092 23.84l6.259-1.642a11.83 11.83 0 0 0 5.65 1.44h.005c6.512 0 11.814-5.3 11.817-11.814a11.82 11.82 0 0 0-3.466-8.386z"/></svg>';
    const copy=create("span","wa-settings-entry-copy");
    copy.append(create("strong","","WhatsApp"),create("small","","Тексты при записи и завершении заказа"));
    entry.append(icon,copy,create("span","wa-settings-chevron","›"));
    const editor=create("section","wa-settings-editor");
    editor.id="wa-settings-editor-"+id;editor.hidden=true;
    entry.setAttribute("aria-controls",editor.id);
    const back=create("button","wa-settings-back rd-opening","← Настройки");back.type="button";
    const heading=create("h2","wa-settings-heading","WhatsApp · сообщения клиентам");
    heading.tabIndex=-1;
    editor.append(back,heading,
      create("p","wa-settings-intro",
        "Измени текст один раз. При создании и закрытии заказа он подставится в WhatsApp автоматически. Отправка остаётся ручной."));
    const tokenNames={имя:"Имя",дата:"Дата",время:"Время",мастер:"Мастер",адрес:"Адрес",ссылка:"Ссылка на отзыв"};
    const sample={name:"Александр",phone:"+7 900 000-00-00",date:"2026-11-20",time:"12:00",master:"Рауль",address:"Владикавказ"};
    const forms={},linkFields={};
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
    const linksHeading=create("h3","wa-review-links-heading","Ссылки на отзывы по источникам");
    const linksNote=create("p","wa-settings-hint",
      "Для каждого источника можно указать свою ссылку. Если ссылка не задана, клиент получит просьбу об отзыве без ссылки на другую площадку.");
    const linksArea=create("div","wa-review-links");
    for(const key of wa().REVIEW_SOURCE_KEYS){
      const wrapper=create("div","wa-review-link-field");
      const label=create("label","wa-settings-label",wa().sourceLabel(key));
      const input=create("input","wa-settings-url");
      input.type="url";input.inputMode="url";input.autocomplete="off";
      input.placeholder="https://...";input.id="wa-review-source-"+key+"-"+id;
      label.htmlFor=input.id;
      wrapper.append(label,input);linksArea.append(wrapper);
      linkFields[key]=input;input.addEventListener("input",refreshPreview);
    }
    const previewSourceLabel=create("label","wa-settings-label","Источник для предпросмотра");
    const previewSource=create("select","wa-settings-url");
    previewSource.id="wa-review-preview-source-"+id;
    previewSourceLabel.htmlFor=previewSource.id;
    const missing=create("option","","Источник не указан");missing.value="";previewSource.append(missing);
    for(const source of wa().CLIENT_SOURCES){
      const item=create("option","",source.label);item.value=source.value;
      previewSource.append(item);
    }
    previewSource.value="avito";
    previewSource.addEventListener("change",refreshPreview);
    editor.append(linksHeading,linksNote,linksArea,previewSourceLabel,previewSource);
    const urlField=create("input","wa-settings-url");
    urlField.id="wa-review-url-"+id;urlField.type="url";urlField.inputMode="url";
    urlField.placeholder="https://...";urlField.autocomplete="off";
    const urlLabel=create("label","wa-settings-label","Общая ссылка для старых заказов без источника (необязательно)");
    urlLabel.htmlFor=urlField.id;
    const urlNote=create("p","wa-settings-hint",
      "Для новых заказов с выбранным источником используется только ссылка соответствующей площадки. Общая ссылка остаётся для прежних заказов без источника.");
    editor.append(urlLabel,urlField,urlNote);
    urlField.addEventListener("input",refreshPreview);
    const buttons=create("div","wa-settings-actions");
    const save=create("button","wa-settings-save","Сохранить шаблоны");save.type="button";
    const restore=create("button","wa-settings-restore","Стандартные тексты");restore.type="button";
    const status=create("div","wa-settings-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
    const locality=create("p","wa-settings-locality",
      "Настройки хранятся только на этом устройстве. На другом телефоне их нужно настроить отдельно.");
    buttons.append(save,restore);
    editor.append(buttons,status,locality);
    rootBox.append(entry,editor);target.append(rootBox);
    function values(){return {
      booking:forms.booking.field.value,review:forms.review.field.value,reviewUrl:urlField.value,
      reviewUrls:Object.fromEntries(Object.entries(linkFields).map(([key,field])=>[key,field.value]))
    };}
    function setValues(config){
      forms.booking.field.value=config.booking;forms.review.field.value=config.review;
      urlField.value=config.reviewUrl||"";
      for(const [key,field] of Object.entries(linkFields))
        field.value=config.reviewUrls?.[key]||"";
      refreshPreview();
    }
    function refreshPreview(){
      const draft=values();
      try{forms.booking.preview.textContent=wa().renderTemplate(draft.booking,sample);}
      catch(_){forms.booking.preview.textContent="Проверьте дату и текст сообщения.";}
      try{
        const settings=wa().validateSettings({...wa().defaults(),...draft});
        forms.review.preview.textContent=wa().reviewText(
          {...sample,clientSource:previewSource.value},undefined,settings
        );
      }catch(_){forms.review.preview.textContent="Проверьте текст или ссылку.";}
    }
    function closeEditor(){
      const stored=wa().getSettings();
      if(JSON.stringify(values())!==JSON.stringify(stored)&&
          !root.confirm("Несохранённые изменения будут потеряны. Закрыть?"))return;
      editor.hidden=true;entry.hidden=false;entry.setAttribute("aria-expanded","false");
      entry.focus({preventScroll:true});
    }
    entry.addEventListener("click",(event)=>{
      setValues(wa().getSettings());status.textContent="";
      editor.hidden=false;entry.hidden=true;entry.setAttribute("aria-expanded","true");
      const keyboardActivation=!event||event.detail===0;
      // WebKit may not show :focus-visible after programmatic focus.
      back.setAttribute("data-keyboard-open",String(keyboardActivation));
      if(keyboardActivation)back.focus({preventScroll:true});
      else heading.focus({preventScroll:true});
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
      if(!root.confirm("Вернуть стандартные тексты? Сохранённые ссылки на отзывы останутся без изменений."))return;
      try{
        // Never wipe the owner's painstakingly configured review URLs.
        const current=values();
        const original=wa().saveSettings({
          ...current,booking:wa().DEFAULT_TEMPLATES.booking,review:wa().DEFAULT_TEMPLATES.review
        });
        setValues(original);status.classList.remove("is-error");
        status.textContent="Тексты восстановлены. Все ссылки на отзывы сохранены.";
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
