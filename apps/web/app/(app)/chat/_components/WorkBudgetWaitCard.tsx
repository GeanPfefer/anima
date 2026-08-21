'use client';
import { useState } from 'react';
import type { WorkBudgetWaitProjection } from '@anima/core';
import styles from './chat.module.css';

// INTEL-04 (coerência V0). Um item bloqueado por orçamento aguarda a JANELA
// MÓVEL liberar — nunca uma decisão humana. Este cartão declara isso com
// honestidade (não é um cartão de decisão) e oferece só reverificar/retomar; ele
// não oferece override do teto 6/24h, que permanece um limite de segurança.
const reasonLabels:Record<WorkBudgetWaitProjection['reason'],string>={
  item_attempt_budget_exhausted:'Limite de tentativas deste item nas últimas 24h',
  user_attempt_budget_exhausted:'Limite global de tentativas autônomas nas últimas 24h',
  user_runtime_budget_exhausted:'Limite global de tempo autônomo nas últimas 24h',
  interactive_reserve_protected:'Reserva interativa da janela de 60 minutos preservada',
};

export function WorkBudgetWaitCard({wait,workItemId,expectedProposalVersion,onReload}:{wait:WorkBudgetWaitProjection;workItemId:string;expectedProposalVersion:number;onReload:()=>Promise<void>}){
  const[busy,setBusy]=useState(false);const[error,setError]=useState('');const[note,setNote]=useState('');
  async function retry(){
    if(busy)return;setBusy(true);setError('');setNote('');
    try{
      const response=await fetch('/api/work-orchestration/supervisor-turn',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workItemId,expectedProposalVersion})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body.ok){setError(body.error?.message??'Não foi possível reverificar o orçamento agora.');return;}
      // Ainda bloqueado: a janela não liberou. Honesto: não fingimos progresso.
      if(body.value?.outcome==='no_eligible_work'||body.value?.outcome==='budget_interrupted')setNote('A janela do orçamento ainda não liberou. Nada foi executado; tente novamente mais tarde.');
    }catch{
      setError('A conexão falhou; o estado do orçamento não foi alterado.');
    }finally{
      setBusy(false);await onReload();
    }
  }
  return <section className={styles.workNotice} aria-label="Aguardando janela de orçamento">
    <strong>Aguardando a janela do orçamento autônomo</strong>
    <p>{reasonLabels[wait.reason]}. Este bloqueio é temporal e não exige nenhuma decisão sua: o trabalho volta a ficar elegível automaticamente quando a janela móvel do orçamento liberar. O teto de segurança do modo autônomo permanece inalterado.</p>
    <div className={styles.workActions}><button disabled={busy} onClick={retry}>Reverificar orçamento e retomar</button></div>
    {note&&<p role="status">{note}</p>}
    {error&&<p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
