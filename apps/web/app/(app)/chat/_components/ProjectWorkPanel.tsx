'use client';
import { useState } from 'react';
import styles from './chat.module.css';
import { WorkProposalCard, type WorkPresentationView } from './WorkProposalCard';
import { presentWorkReencounter } from './work-item-presentation';

type Props={items:readonly WorkPresentationView[];focusedWorkItemId:string|null;onFocus:(id:string)=>void;onChange:(value:WorkPresentationView)=>void};
export function ProjectWorkPanel({items,focusedWorkItemId,onFocus,onChange}:Props){
  const [expanded,setExpanded]=useState<string|null>(null);
  const rows=presentWorkReencounter(items);
  if(rows.length===0)return null;
  return <section className={styles.projectWorkPanel} aria-label="Trabalhos do projeto">
    <h2>Trabalhos do projeto</h2><p>Visão somente leitura dos trabalhos que você pode reencontrar.</p>
    {rows.map(({presentation,dependencyIds,blockingDependencyIds,autonomousEligible,readinessLabel})=><div key={presentation.item.id} className={styles.projectWorkRow}>
      <div><strong>{presentation.item.proposal.data.summary}</strong><span>{presentation.item.state} · v{presentation.item.proposalVersion}</span></div>
      <p>{readinessLabel}</p>
      <p className={styles.workNotice}>Classificação: {autonomousEligible||blockingDependencyIds.length>0?'contrato válido':'pendente'} · Dependências: {dependencyIds.length?dependencyIds.join(', '):'nenhuma'} · fonte {presentation.item.sourceMessageId}</p>
      <button type="button" onClick={()=>setExpanded(expanded===presentation.item.id?null:presentation.item.id)}>{expanded===presentation.item.id?'Ocultar detalhes':'Ver detalhes'}</button>
      {expanded===presentation.item.id&&<WorkProposalCard presentation={presentation} focused={focusedWorkItemId===presentation.item.id} onFocus={()=>onFocus(presentation.item.id)} onChange={onChange} autonomousExecutionAllowed={autonomousEligible} autonomousBlockReason={blockingDependencyIds.length?readinessLabel:null}/>} 
    </div>)}
  </section>;
}
