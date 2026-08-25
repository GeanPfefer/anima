'use client';
import { useState } from 'react';
import { describeCostClass, describeExecutionAdvisory, describeMachinePressure, describeValidationOutcome, evaluateAutonomousEligibility, formatObservedDurationMs, parseWorkResultValidations, type ApprovalDecision, type MachinePressure, type ResultReviewDecision, type WorkItem, type WorkloadAdvisory, type WorkPresentation, type WorkVerificationVerdict } from '@anima/core';
import styles from './chat.module.css';
import { WorkExecutionCard } from './WorkExecutionCard';
import { WorkDecisionCard } from './WorkDecisionCard';
import { WorkBudgetWaitCard } from './WorkBudgetWaitCard';
import type { AutonomousReadinessView } from '@/lib/work-orchestration/autonomous-readiness';
import type { WorkRetryReadiness } from '@/lib/work-orchestration/retry-readiness';

type WorkItemView=Omit<WorkItem,'createdAt'|'updatedAt'>&{createdAt:string;updatedAt:string};
export type WorkPresentationView=Omit<WorkPresentation,'item'>&{item:WorkItemView;autonomousReadiness?:AutonomousReadinessView;retryReadiness?:WorkRetryReadiness};
type Props={presentation:WorkPresentationView;onChange:(value:WorkPresentationView)=>void;focused?:boolean;onFocus?:()=>void;autonomousExecutionAllowed?:boolean;autonomousBlockReason?:string|null};

// Rótulos do parecer advisory do Verifier. Read-only: informa a revisão humana,
// nunca a substitui nem altera as ações disponíveis (que vêm da projeção).
const VERDICT_LABEL:Record<WorkVerificationVerdict,string>={
  verified:'evidência suficiente e coerente com o contrato aprovado',
  inconclusive:'evidência insuficiente para concluir automaticamente',
  rejected:'evidência de violação ou incoerência com o contrato aprovado',
};
const newRequestId=()=>typeof crypto.randomUUID==='function'?crypto.randomUUID():`00000000-0000-4000-8000-${Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12)}`;
// Motivos estruturados de bloqueio do retry (espelham a RPC autoritativa
// `work_retry_readiness`). Quando há um motivo conhecido, a UI o mostra em vez da
// mensagem genérica — sem inventar razão nem afrouxar qualquer gate.
const RETRY_BLOCK_LABEL:Record<string,string>={
  latest_terminal_not_retryable_failure:'a última evidência terminal não é uma falha recuperável',
  failure_not_retryable:'a falha registrada não foi marcada como recuperável',
  proposal_changed:'a proposta mudou desde a falha',
  failure_attempt_missing:'a falha não referencia uma tentativa',
  attempt_budget_exhausted:'as tentativas do orçamento se esgotaram',
  approval_missing:'não há aprovação vigente para esta versão',
  classification_invalid:'a classificação vigente não habilita execução autônoma',
  dependencies_unsatisfied:'dependências ainda não foram concluídas',
  open_claim:'há um claim aberto para este trabalho',
  active_attempt:'há uma tentativa ativa em andamento',
  target_or_envelope_invalid:'o alvo ou o envelope de execução é inválido',
  read_failed:'não foi possível reler a elegibilidade de nova tentativa',
};
const describeRetryBlock=(readiness?:WorkRetryReadiness):string|null=>
  readiness?.status==='BLOCKED'&&readiness.reason?RETRY_BLOCK_LABEL[readiness.reason]??null:null;


export function WorkProposalCard({presentation,onChange,focused=false,onFocus,autonomousExecutionAllowed,autonomousBlockReason}:Props){
  const {item,latestResult,acceptedResult,availableActions}=presentation;
  const executionSpec=item.intent['execution_spec'] as {
    target?:{kind?:string;reference?:string};permissions?:string[];
    validation_criteria?:Array<{label?:string;command?:string}>;
    limits?:{max_attempts?:number;max_duration_minutes?:number};
  }|undefined;
  const [status,setStatus]=useState<'idle'|'submitting'|'reconciling'>('idle');
  const [error,setError]=useState('');
  // Advisory do Resource Governor devolvido pela última execução autônoma (read-only).
  // Transparência: mostra o parecer machine-wide; nunca decidiu/bloqueou esta execução.
  const [resourceAdvisory,setResourceAdvisory]=useState<{pressure:MachinePressure;advisories:readonly WorkloadAdvisory[]}|null>(null);
  const [mode,setMode]=useState<'none'|'defer'|'correct'|'result'|'review_changes'>('none');
  const [detail,setDetail]=useState('');const[customDeferReason,setCustomDeferReason]=useState('');const[references,setReferences]=useState('');const[validations,setValidations]=useState('');const[limitations,setLimitations]=useState('');
  const allowed=(action:WorkPresentation['availableActions'][number])=>availableActions.includes(action);
  const authoritativeAllowed=autonomousExecutionAllowed??presentation.autonomousReadiness?.eligible??false;
  const autonomousEligible=evaluateAutonomousEligibility(item as unknown as WorkItem).eligible&&authoritativeAllowed;
  const projectedBlockReason=autonomousBlockReason??(presentation.autonomousReadiness?.reason==='blocked_by_dependency'?`Aguardando conclusão de ${presentation.autonomousReadiness.blockingDependencyIds.join(', ')}`:null);
  // Consulta read-only do parecer de recursos ANTES de rodar: para os gates declarados
  // no contrato, o parecer relativo ao histórico machine-wide + a pressão atual. Silencioso
  // em falha (a ausência do painel é o fallback honesto); nunca decide nem bloqueia.
  async function loadResourceAdvisory(){
    try{
      const response=await fetch(`/api/work-orchestration/items/${item.id}/resource-advisory`);
      const body=await response.json().catch(()=>({}));
      const governor=body.value?.resourceGovernor as {pressure:MachinePressure;advisories:readonly WorkloadAdvisory[]}|undefined;
      if(response.ok&&body.ok&&governor)setResourceAdvisory({pressure:governor.pressure,advisories:governor.advisories});
    }catch{/* read-only: sem painel em falha */}
  }
  async function reload(preserveError=false){setStatus('reconciling');const response=await fetch(`/api/work-orchestration/items/${item.id}`);const body=await response.json();if(response.ok&&body.ok){onChange(body.value.presentation as WorkPresentationView);if(!preserveError)setError('');}else setError(body.error?.message??'Não foi possível reler o trabalho.');setStatus('idle');}
  async function mutate(endpoint:string,payload:Record<string,unknown>){if(status!=='idle')return;setStatus('submitting');setError('');const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workItemId:item.id,expectedProposalVersion:item.proposalVersion,...payload})});const body=await response.json().catch(()=>({}));if(response.ok&&body.ok){setMode('none');setDetail('');setReferences('');setValidations('');setLimitations('');setCustomDeferReason('');await reload();return;}const message=body.error?.message??'Não foi possível atualizar o trabalho.';setError(message);setStatus('idle');if(body.error?.code==='version_conflict'||body.error?.code==='ambiguous_outcome'){await reload();setError(message);}}
  async function startAutonomous(){
    if(status!=='idle')return;
    setStatus('submitting');setError('');
    try{
      const executionRequest=fetch('/api/work-orchestration/execution-requests',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({workItemId:item.id,expectedProposalVersion:item.proposalVersion,requestId:newRequestId()}),
      });
      const response=await executionRequest;
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body.ok)setError(body.error?.message??'Não foi possível sinalizar este trabalho ao Resident Host.');
    }catch{
      setError('A conexão falhou; nenhuma execução foi presumida.');
    }finally{
      await reload(true).catch(()=>setStatus('idle'));
    }
  }
  async function retryAutonomous(){
    const retry=presentation.retryReadiness;
    if(status!=='idle'||retry?.status!=='RETRY_READY'||!retry.failureEventId)return;
    setStatus('submitting');setError('');
    try{
      const response=await fetch('/api/work-orchestration/retries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workItemId:item.id,expectedProposalVersion:item.proposalVersion,failureEventId:retry.failureEventId,retryRequestId:newRequestId()})});
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body.ok)setError(body.error?.message??'A nova tentativa não pôde ser autorizada.');
      await reload(!response.ok||!body.ok);
    }catch{setError('A conexão falhou; nenhuma nova tentativa foi presumida.');await reload(true).catch(()=>setStatus('idle'));}
  }
  const decide=(decision:ApprovalDecision)=>mutate('/api/work-orchestration/decisions',{decision});
  const review=(decision:ResultReviewDecision)=>mutate('/api/work-orchestration/reviews',{decision,reviewedResultEventId:latestResult?.eventId});
  async function decideIntegration(decision:'authorize'|'refuse'){
    if(status!=='idle'||!presentation.integration?.availableDecisions.includes(decision))return;
    setStatus('submitting');setError('');
    try{
      const response=await fetch('/api/work-orchestration/integration-decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        workItemId:item.id,expectedProposalVersion:item.proposalVersion,
        acceptedResultEventId:presentation.integration.acceptedResultEventId,
        decision,decisionId:`integration:${presentation.integration.acceptedResultEventId}:${decision}`,
      })});
      const body=await response.json().catch(()=>({}));
      if(!response.ok||!body.ok)setError(body.error?.message??'Não foi possível registrar a decisão de integração.');
      await reload(Boolean(!response.ok||!body.ok));
    }catch{
      setError('A conexão falhou; nenhuma decisão de integração foi presumida.');
      await reload(true).catch(()=>setStatus('idle'));
    }
  }
  const busy=status!=='idle';
  return <article className={styles.workCard} aria-label={`Trabalho, versão ${item.proposalVersion}`} aria-busy={busy}>
    <div className={styles.workCardHeader}><strong>{focused?'Trabalho em foco':'Proposta de trabalho'}</strong><span>{item.state} · v{item.proposalVersion}</span></div>
    {/* Fase humana (read-only): projeção pura dos fatos — nunca narrativa do LLM.
       Defensivo: uma projeção antiga (cache/rede anterior ao deploy) pode não ter
       `progress`; nesse caso o indicador só não aparece, em vez de quebrar o cartão. */}
    {presentation.progress&&<div className={styles.workPhase} data-active={presentation.progress.active} data-terminal={presentation.progress.terminal} aria-label={`Fase do trabalho: ${presentation.progress.label}`}>{presentation.progress.active&&<span className={styles.workPhaseDot} aria-hidden="true" />}{presentation.progress.label}</div>}
    <h3>{item.proposal.data.summary}</h3><p>{item.proposal.data.objective}</p>
    {presentation.provenance?.status==='incomplete'&&<p role="alert" className={styles.error}>A proveniência persistida deste trabalho está incompleta. As ações permanecem bloqueadas para evitar uma decisão sobre contexto inconsistente.</p>}
    <dl className={styles.workMeta}><div><dt>Capacidade</dt><dd>{item.capability}</dd></div><div><dt>Impacto</dt><dd>{item.impactLevel}</dd></div></dl>
    <section><strong>Inclui</strong><ul>{item.proposal.data.includedScope.map(value=><li key={value}>{value}</li>)}</ul></section>
    <section><strong>Não inclui</strong><ul>{item.proposal.data.excludedScope.map(value=><li key={value}>{value}</li>)}</ul></section>
    <section><strong>Efeitos esperados</strong><ul>{item.proposal.data.expectedEffects.map(value=><li key={value}>{value}</li>)}</ul></section>
    <section><strong>Riscos</strong>{item.proposal.data.risks.length?<ul>{item.proposal.data.risks.map(value=><li key={value}>{value}</li>)}</ul>:<p>Nenhum risco declarado.</p>}</section>
    {executionSpec&&<section className={styles.workNotice} aria-label="Especificação de execução">
      <strong>Execução local proposta</strong>
      <dl className={styles.workMeta}>
        <div><dt>Alvo</dt><dd>{executionSpec.target?.reference??'Não declarado'}</dd></div>
        <div><dt>Permissões</dt><dd>{executionSpec.permissions?.join(', ')??'Não declaradas'}</dd></div>
        <div><dt>Limites</dt><dd>{executionSpec.limits?.max_attempts??'?'} tentativas · {executionSpec.limits?.max_duration_minutes??'?'} min</dd></div>
      </dl>
      <strong>Validação</strong>
      <ul>{executionSpec.validation_criteria?.map((criterion,index)=><li key={`${criterion.label}-${index}`}>{criterion.label}{criterion.command?` — ${criterion.command}`:''}</li>)}</ul>
      <p>A execução ocorrerá numa workspace isolada e retornará para revisão antes de qualquer aplicação no projeto original.</p>
    </section>}
    {(()=>{const shown=item.state==='review'?latestResult:item.state==='completed'?acceptedResult:null;if(!shown)return null;return <section aria-label={item.state==='completed'?'Resultado aceito':'Resultado para revisão'} className={styles.workNotice}>
      <strong>{item.state==='completed'?'Resultado aceito':'Resultado'} · v{shown.proposalVersion}</strong>
      <p><em>Relato de {shown.author}, não verificado automaticamente:</em> {shown.summary}</p>
      <dl className={styles.workMeta}>
        <div><dt>Autoria</dt><dd>{shown.author}</dd></div>
        <div><dt>Referências</dt><dd>{shown.references.length?shown.references.join(', '):'Nenhuma referência informada'}</dd></div>
        <div><dt>Validações</dt><dd>{shown.validations===null?'Nenhuma validação registrada':shown.validations.length===0?'Nenhuma validação registrada':shown.validations.map(validation=>`${validation.label} — ${describeValidationOutcome(validation.outcome)}`).join('; ')}</dd></div>
        <div><dt>Limitações</dt><dd>{shown.limitations===null||shown.limitations.length===0?'Nenhuma limitação declarada':shown.limitations.join('; ')}</dd></div>
        <div><dt>Handoff</dt><dd>{shown.handoffReference??'Nenhuma referência de handoff'}</dd></div>
      </dl>
    </section>;})()}
    {presentation.verification&&<section aria-label="Verificação independente" className={styles.workNotice}>
      <strong>Verificação independente (advisory)</strong>
      <p>Parecer do Verifier: {VERDICT_LABEL[presentation.verification.verdict]}. É consultivo e não substitui a sua revisão nem os gates.</p>
      {presentation.verification.restsOnAttestedEvidence&&<p>Baseado na evidência <strong>reportada pelo executor</strong> (gates, arquivos alterados) e conferida contra o contrato aprovado — não é prova independente de que o resultado está correto.</p>}
      {presentation.verification.findings.some(finding=>finding.severity!=='ok')&&<ul>{presentation.verification.findings.filter(finding=>finding.severity!=='ok').map((finding,index)=><li key={`${finding.code}-${index}`}>{finding.severity==='violation'?'Violação':'Lacuna'}: {finding.detail}</li>)}</ul>}
    </section>}
    {presentation.resourceCost&&presentation.resourceCost.profiles.length>0&&<section aria-label="Custo de recursos observado" className={styles.workNotice}>
      <strong>Custo de recursos observado (gates)</strong>
      <p>Derivado do que o host mediu ao rodar os gates deste trabalho. Read-only: informa o custo histórico, não decide, não bloqueia e não muda a elegibilidade. A classe é relativa ao custo observado deste item.</p>
      <ul>{presentation.resourceCost.profiles.map(profile=><li key={`${profile.key.workloadKind}-${profile.key.command}`}>{profile.key.command} — {profile.count}× · mediana {formatObservedDurationMs(profile.durationMedianMs)} · custo {describeCostClass(profile.predominantClass)}{profile.failureCount>0?` · ${profile.failureCount} falha(s)`:''}</li>)}</ul>
    </section>}
    {resourceAdvisory&&<section aria-label="Parecer do Resource Governor" className={styles.workNotice}>
      <strong>Resource Governor (advisory)</strong>
      <p>Pressão da máquina agora: {describeMachinePressure(resourceAdvisory.pressure)}. Parecer consultivo por workload, relativo ao histórico de custo de toda a máquina. Read-only: informa a decisão de rodar, não decide, não bloqueia e não muda a elegibilidade.</p>
      <ul>{resourceAdvisory.advisories.map(entry=><li key={`${entry.key.workloadKind}-${entry.key.command}`}>{entry.key.command} — custo {describeCostClass(entry.advisory.basis.workloadClass)}: {describeExecutionAdvisory(entry.advisory.recommendation)}</li>)}</ul>
    </section>}
    <p className={styles.workNotice}>{item.state==='proposed'?'Aguardando sua decisão.':item.state==='approved'?'Aprovado; execução ainda não iniciada.':item.state==='in_progress'?'Execução manual em andamento; quando terminar, registre o resultado abaixo. O Supervisor não assume um ciclo manual já iniciado.':item.state==='review'?(latestResult?'Revise as evidências acima antes de decidir.':'O resultado registrado não pôde ser verificado; o aceite permanece bloqueado até um novo envio.'):item.state==='changes_requested'?'Correções solicitadas; histórico preservado.':item.state==='completed'?(acceptedResult?(presentation.integration?.status==='awaiting_decision'?'Resultado aceito; a decisão de integração está pendente abaixo. Nada foi publicado, enviado ou mergeado.':'Resultado aceito e trabalho concluído; evidências preservadas acima.'):'Trabalho concluído, mas as evidências do resultado aceito não puderam ser verificadas.'):item.state==='failed'?(presentation.retryReadiness?.status==='RETRY_READY'?`A tentativa ${presentation.retryReadiness.attemptsUsed} de ${presentation.retryReadiness.maxAttempts} falhou. O histórico foi preservado e há uma nova tentativa disponível.`:describeRetryBlock(presentation.retryReadiness)?`A execução falhou; nova tentativa indisponível: ${describeRetryBlock(presentation.retryReadiness)}.`:'A execução falhou; nenhuma nova tentativa está autorizável no estado atual.'):`Estado atual: ${item.state}.`}</p>
    {presentation.execution&&<WorkExecutionCard execution={presentation.execution} workItemId={item.id} proposalVersion={item.proposalVersion} onReload={reload} />}
    {presentation.pendingDecision&&<WorkDecisionCard decision={presentation.pendingDecision} workItemId={item.id} onReload={reload} />}
    {presentation.pendingBudgetWait&&<WorkBudgetWaitCard wait={presentation.pendingBudgetWait} workItemId={item.id} expectedProposalVersion={item.proposalVersion} onReload={reload} />}
    {presentation.integration&&<section className={styles.workNotice} aria-label="Decisão de integração">
      <strong>{presentation.integration.status==='awaiting_decision'?'Integração aguardando sua decisão':presentation.integration.status==='authorized'?'Integração autorizada':presentation.integration.status==='branch_published'?'Branch publicada':presentation.integration.status==='review_request_created'?'Review request criado':'Integração recusada'}</strong>
      <p>{presentation.integration.status==='awaiting_decision'?'O resultado foi aceito. Autorizar permite uma futura execução protegida; não publica, envia, cria PR ou integra agora.':presentation.integration.status==='authorized'?'Autorizada e aguardando publicação protegida. Nada foi publicado, enviado, integrado ou mergeado.':presentation.integration.status==='branch_published'?`Branch ${presentation.integration.publication?.remoteBranch??''} publicada no commit ${presentation.integration.publication?.commitSha.slice(0,7)??''}. Nenhum PR foi criado e nada foi mergeado ou integrado.`:presentation.integration.status==='review_request_created'?`Review request ${presentation.integration.reviewRequest?.reviewReference??''} aberto para a branch ${presentation.integration.reviewRequest?.sourceBranch??''}. Aguarda revisão humana e decisão de merge; nada foi mergeado ou integrado.`:'A integração deste resultado foi recusada. Nenhum efeito externo ocorreu.'}</p>
      {presentation.integration.availableDecisions.length>0&&<div className={styles.workActions}><button disabled={busy} onClick={()=>void decideIntegration('authorize')}>Autorizar integração</button><button disabled={busy} onClick={()=>void decideIntegration('refuse')}>Recusar integração</button></div>}
    </section>}
    {!focused&&onFocus&&!['completed','failed','rejected','cancelled'].includes(item.state)&&<button disabled={busy} onClick={onFocus}>Usar como foco</button>}
    {mode==='none'&&allowed('approve')&&<div className={styles.workActions}><button disabled={busy} onClick={()=>decide({type:'approve'})}>Aprovar</button><button disabled={busy} onClick={()=>setMode('correct')}>Pedir correção</button><button disabled={busy} onClick={()=>setMode('defer')}>Adiar</button><button disabled={busy} onClick={()=>decide({type:'reject'})}>Rejeitar</button></div>}
    {mode==='defer'&&<div className={styles.workDecision}><label>Motivo<select value={detail} onChange={event=>setDetail(event.target.value)}><option value="">Selecione</option><option>Quero decidir depois</option><option>Falta contexto</option><option>Não é prioridade agora</option><option value="other">Outro</option></select></label>{detail==='other'&&<input aria-label="Outro motivo" value={customDeferReason} onChange={event=>setCustomDeferReason(event.target.value)}/>}<button disabled={busy||!(detail==='other'?customDeferReason:detail).trim()} onClick={()=>decide({type:'defer',reason:detail==='other'?customDeferReason:detail})}>Confirmar adiamento</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {mode==='correct'&&<div className={styles.workDecision}><label>O que deve mudar?<textarea value={detail} onChange={event=>setDetail(event.target.value)}/></label><button disabled={busy||!detail.trim()} onClick={()=>mutate('/api/work-orchestration/proposal-corrections',{requestedChanges:detail.trim()})}>Criar nova versão coerente</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {mode==='none'&&!presentation.pendingDecision&&allowed('start')&&<><p className={styles.workNotice}>No modo manual, você executa o trabalho e registra o resultado aqui. O Supervisor não assumirá esse ciclo depois de iniciado.</p>{projectedBlockReason&&<p className={styles.workNotice}>Execução autônoma indisponível: {projectedBlockReason}</p>}<div className={styles.workActions}><button disabled={busy} onClick={()=>mutate('/api/work-orchestration/start',{})}>{item.state==='approved'?'Iniciar execução manual':'Retomar trabalho manual'}</button>{item.state==='approved'&&autonomousEligible&&<><button disabled={busy} onClick={()=>void loadResourceAdvisory()}>Consultar parecer de recursos</button><button disabled={busy} onClick={startAutonomous}>Executar autonomamente</button></>}</div></>}
    {mode==='none'&&allowed('submit_result')&&<div className={styles.workActions}><button disabled={busy} onClick={()=>setMode('result')}>Registrar resultado</button></div>}
    {mode==='none'&&item.state==='failed'&&presentation.retryReadiness?.status==='RETRY_READY'&&<section className={styles.workNotice} aria-label="Nova tentativa governada"><strong>Falha recuperável</strong><p>{presentation.retryReadiness.attemptsUsed} de {presentation.retryReadiness.maxAttempts} tentativas utilizada. O Resource Governor será reavaliado pelo Resident Host antes de qualquer nova execução.</p><div className={styles.workActions}><button disabled={busy} onClick={()=>void retryAutonomous()}>Tentar novamente autonomamente</button></div></section>}
    {mode==='result'&&<div className={styles.workDecision}><label>Resumo do resultado<textarea value={detail} onChange={event=>setDetail(event.target.value)}/></label><label>Referências, uma por linha<textarea value={references} onChange={event=>setReferences(event.target.value)}/></label><label>Validações executadas, uma por linha (prefixe com ok: ou falha:)<textarea value={validations} onChange={event=>setValidations(event.target.value)}/></label><label>Limitações conhecidas, uma por linha<textarea value={limitations} onChange={event=>setLimitations(event.target.value)}/></label><button disabled={busy||!detail.trim()} onClick={()=>mutate('/api/work-orchestration/results',{result:{summary:detail.trim(),resultReferences:references.split('\n').map(value=>value.trim()).filter(Boolean),validations:parseWorkResultValidations(validations),limitations:limitations.split('\n').map(value=>value.trim()).filter(Boolean)}})}>Enviar para revisão</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {mode==='none'&&allowed('accept_result')&&latestResult&&<div className={styles.workActions}><button disabled={busy} onClick={()=>review({type:'accept'})}>Aceitar resultado v{latestResult.proposalVersion}</button><button disabled={busy} onClick={()=>setMode('review_changes')}>Pedir correções no resultado</button></div>}
    {mode==='review_changes'&&<div className={styles.workDecision}><label>Correções necessárias<textarea value={detail} onChange={event=>setDetail(event.target.value)}/></label><button disabled={busy||!detail.trim()} onClick={()=>review({type:'request_changes',requestedChanges:detail.trim()})}>Confirmar correções</button><button onClick={()=>setMode('none')}>Voltar</button></div>}
    {status==='reconciling'&&<p role="status">Verificando estado atual…</p>}{error&&<p role="alert" className={styles.error}>{error} Você pode tentar novamente.</p>}
  </article>;
}
