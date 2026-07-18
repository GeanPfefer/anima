'use client';
import { useState } from 'react';
import { describeValidationOutcome, parseWorkResultValidations, type ApprovalDecision, type ResultReviewDecision, type WorkItem, type WorkPresentation } from '@anima/core';
import styles from './chat.module.css';

type WorkItemView=Omit<WorkItem,'createdAt'|'updatedAt'>&{createdAt:string;updatedAt:string};
export type WorkPresentationView=Omit<WorkPresentation,'item'>&{item:WorkItemView};
type Props={presentation:WorkPresentationView;onChange:(value:WorkPresentationView)=>void;focused?:boolean;onFocus?:()=>void};

export function WorkProposalCard({presentation,onChange,focused=false,onFocus}:Props){
  const {item,latestResult,acceptedResult,availableActions}=presentation;
  const [status,setStatus]=useState<'idle'|'submitting'|'reconciling'>('idle');
  const [error,setError]=useState('');
  const [mode,setMode]=useState<'none'|'defer'|'correct'|'result'|'review_changes'>('none');
  const [detail,setDetail]=useState('');const[customDeferReason,setCustomDeferReason]=useState('');const[references,setReferences]=useState('');const[validations,setValidations]=useState('');const[limitations,setLimitations]=useState('');
  const allowed=(action:WorkPresentation['availableActions'][number])=>availableActions.includes(action);
  async function reload(){setStatus('reconciling');const response=await fetch(`/api/work-orchestration/items/${item.id}`);const body=await response.json();if(response.ok&&body.ok){onChange(body.value.presentation as WorkPresentationView);setError('');}else setError(body.error?.message??'Não foi possível reler o trabalho.');setStatus('idle');}
  async function mutate(endpoint:string,payload:Record<string,unknown>){if(status!=='idle')return;setStatus('submitting');setError('');const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workItemId:item.id,expectedProposalVersion:item.proposalVersion,...payload})});const body=await response.json().catch(()=>({}));if(response.ok&&body.ok){setMode('none');setDetail('');setReferences('');setValidations('');setLimitations('');setCustomDeferReason('');await reload();return;}const message=body.error?.message??'Não foi possível atualizar o trabalho.';setError(message);setStatus('idle');if(body.error?.code==='version_conflict'||body.error?.code==='ambiguous_outcome'){await reload();setError(message);}}
  const decide=(decision:ApprovalDecision)=>mutate('/api/work-orchestration/decisions',{decision});
  const review=(decision:ResultReviewDecision)=>mutate('/api/work-orchestration/reviews',{decision,reviewedResultEventId:latestResult?.eventId});
  const busy=status!=='idle';
  return <article className={styles.workCard} aria-label={`Trabalho, versão ${item.proposalVersion}`} aria-busy={busy}>
    <div className={styles.workCardHeader}><strong>{focused?'Trabalho em foco':'Proposta de trabalho'}</strong><span>{item.state} · v{item.proposalVersion}</span></div>
    <h3>{item.proposal.data.summary}</h3><p>{item.proposal.data.objective}</p>
    {presentation.provenance?.status==='incomplete'&&<p role="alert" className={styles.error}>A proveniência persistida deste trabalho está incompleta. As ações permanecem bloqueadas para evitar uma decisão sobre contexto inconsistente.</p>}
    <dl className={styles.workMeta}><div><dt>Capacidade</dt><dd>{item.capability}</dd></div><div><dt>Impacto</dt><dd>{item.impactLevel}</dd></div></dl>
    <section><strong>Inclui</strong><ul>{item.proposal.data.includedScope.map(value=><li key={value}>{value}</li>)}</ul></section>
    <section><strong>Não inclui</strong><ul>{item.proposal.data.excludedScope.map(value=><li key={value}>{value}</li>)}</ul></section>
    <section><strong>Riscos</strong>{item.proposal.data.risks.length?<ul>{item.proposal.data.risks.map(value=><li key={value}>{value}</li>)}</ul>:<p>Nenhum risco declarado.</p>}</section>
    {(()=>{const shown=item.state==='review'?latestResult:item.state==='completed'?acceptedResult:null;if(!shown)return null;return <section aria-label={item.state==='completed'?'Resultado aceito':'Resultado para revisão'} className={styles.workNotice}>
      <strong>{item.state==='completed'?'Resultado aceito':'Resultado'} · v{shown.proposalVersion}</strong>
      <p><em>Relato de {shown.author}, não verificado automaticamente:</em> {shown.summary}</p>
      <dl className={styles.workMeta}>
        <div><dt>Autoria</dt><dd>{shown.author}</dd></div>
        <div><dt>Referências</dt><dd>{shown.references.length?shown.references.join(', '):'Nenhuma referência informada'}</dd></div>
        <div><dt>Validações</dt><dd>{shown.validations===null?'Nenhuma validação registrada':shown.validations.length===0?'Nenhuma validação registrada':shown.validations.map(validation=>`${validation.label} — ${describeValidationOutcome(validation.outcome)}`).join('; ')}</dd></div>
        <div><dt>Limitações</dt><dd>{shown.limitations===null||shown.limitations.length===0?'Nenhuma limitação declarada':shown.limitations.join('; ')}</dd></div>
      </dl>
    </section>;})()}
    <p className={styles.workNotice}>{item.state==='proposed'?'Aguardando sua decisão.':item.state==='approved'?'Aprovado; execução ainda não iniciada.':item.state==='in_progress'?'Execução manual em andamento.':item.state==='review'?(latestResult?'Revise as evidências acima antes de decidir.':'O resultado registrado não pôde ser verificado; o aceite permanece bloqueado até um novo envio.'):item.state==='changes_requested'?'Correções solicitadas; histórico preservado.':item.state==='completed'?(acceptedResult?'Resultado aceito e trabalho concluído; evidências preservadas acima.':'Trabalho concluído, mas as evidências do resultado aceito não puderam ser verificadas.'):item.state==='failed'?'A execução falhou; nenhum resultado foi aceito.':`Estado atual: ${item.state}.`}</p>
    {!focused&&onFocus&&!['completed','failed','rejected','cancelled'].includes(item.state)&&<button disabled={busy} onClick={onFocus}>Usar como foco</button>}
    {mode==='none'&&allowed('approve')&&<div className={styles.workActions}><button disabled={busy} onClick={()=>decide({type:'approve'})}>Aprovar</button><button disabled={busy} onClick={()=>setMode('correct')}>Pedir correção</button><button disabled={busy} onClick={()=>setMode('defer')}>Adiar</button><button disabled={busy} onClick={()=>decide({type:'reject'})}>Rejeitar</button></div>}
    {mode==='defer'&&<div className={styles.workDecision}><label>Motivo<select value={detail} onChange={event=>setDetail(event.target.value)}><option value="">Selecione</option><option>Quero decidir depois</option><option>Falta contexto</option><option>Não é prioridade agora</option><option value="other">Outro</option></select></label>{detail==='other'&&<input aria-label="Outro motivo" value={customDeferReason} onChange={event=>setCustomDeferReason(event.target.value)}/>}<button disabled={busy||!(detail==='other'?customDeferReason:detail).trim()} onClick={()=>decide({type:'defer',reason:detail==='other'?customDeferReason:detail})}>Confirmar adiamento</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {mode==='correct'&&<div className={styles.workDecision}><label>O que deve mudar?<textarea value={detail} onChange={event=>setDetail(event.target.value)}/></label><button disabled={busy||!detail.trim()} onClick={()=>mutate('/api/work-orchestration/proposal-corrections',{requestedChanges:detail.trim()})}>Criar nova versão coerente</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {mode==='none'&&allowed('start')&&<div className={styles.workActions}><button disabled={busy} onClick={()=>mutate('/api/work-orchestration/start',{})}>{item.state==='approved'?'Iniciar execução manual':'Retomar trabalho'}</button></div>}
    {mode==='none'&&allowed('submit_result')&&<div className={styles.workActions}><button disabled={busy} onClick={()=>setMode('result')}>Registrar resultado</button></div>}
    {mode==='result'&&<div className={styles.workDecision}><label>Resumo do resultado<textarea value={detail} onChange={event=>setDetail(event.target.value)}/></label><label>Referências, uma por linha<textarea value={references} onChange={event=>setReferences(event.target.value)}/></label><label>Validações executadas, uma por linha (prefixe com ok: ou falha:)<textarea value={validations} onChange={event=>setValidations(event.target.value)}/></label><label>Limitações conhecidas, uma por linha<textarea value={limitations} onChange={event=>setLimitations(event.target.value)}/></label><button disabled={busy||!detail.trim()} onClick={()=>mutate('/api/work-orchestration/results',{result:{summary:detail.trim(),resultReferences:references.split('\n').map(value=>value.trim()).filter(Boolean),validations:parseWorkResultValidations(validations),limitations:limitations.split('\n').map(value=>value.trim()).filter(Boolean)}})}>Enviar para revisão</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {mode==='none'&&allowed('accept_result')&&latestResult&&<div className={styles.workActions}><button disabled={busy} onClick={()=>review({type:'accept'})}>Aceitar resultado v{latestResult.proposalVersion}</button><button disabled={busy} onClick={()=>setMode('review_changes')}>Pedir correções no resultado</button></div>}
    {mode==='review_changes'&&<div className={styles.workDecision}><label>Correções necessárias<textarea value={detail} onChange={event=>setDetail(event.target.value)}/></label><button disabled={busy||!detail.trim()} onClick={()=>review({type:'request_changes',requestedChanges:detail.trim()})}>Confirmar correções</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {status==='reconciling'&&<p role="status">Verificando estado atual…</p>}{error&&<p role="alert" className={styles.error}>{error} Você pode tentar novamente.</p>}
  </article>;
}
