'use client';
import { useState } from 'react';
import type { WorkDecisionProjection } from '@anima/core';
import styles from './chat.module.css';

const reasonLabels:Record<WorkDecisionProjection['reason'],string>={
  scope_change:'Mudança de escopo',
  architectural_decision:'Decisão de arquitetura',
  destructive_action:'Ação destrutiva',
  sensitive_credential_required:'Credencial sensível necessária',
  requirements_conflict:'Conflito entre requisitos',
  permission_missing:'Permissão ausente',
  final_integration_approval:'Aprovação final de integração',
  persistent_inability_after_limits:'Limite atingido sem solução segura',
};

export function WorkDecisionCard({decision,workItemId,onReload}:{decision:WorkDecisionProjection;workItemId:string;onReload:()=>Promise<void>}){
  const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  async function answer(optionId:string){
    if(busy)return;setBusy(true);setError('');
    const response=await fetch('/api/work-orchestration/decision-responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      workItemId,expectedProposalVersion:decision.proposalVersion,
      inputRequestedEventId:decision.requestEventId,optionId,
    })});
    const body=await response.json().catch(()=>({}));
    if(!response.ok||!body.ok){setError(body.error?.message??'Não foi possível registrar sua decisão.');setBusy(false);return;}
    await onReload();
  }
  return <section className={styles.workNotice} aria-label="Decisão necessária">
    <strong>Preciso da sua decisão · {reasonLabels[decision.reason]}</strong>
    <p>{decision.explanation}</p>
    <p>O trabalho está pausado em um checkpoint seguro.</p>
    <div className={styles.workActions}>{decision.options.map(option=><button key={option.id} disabled={busy} onClick={()=>answer(option.id)}>{option.label}</button>)}</div>
    {error&&<p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
