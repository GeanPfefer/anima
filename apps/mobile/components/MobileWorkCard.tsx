import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { parseWorkResultValidations, type WorkPresentation } from '@anima/core';
import { decideWork, decideWorkIntegration, reloadWork, requestHostSupervisorTurn, requestProposalCorrection, respondWorkDecision, reviewWorkResult, startWork, submitWorkResult } from '@/lib/mobile-work';
import { colors, radius, spacing } from '@/constants/theme';
import { describeMissingCompletedResult, presentMobileWorkResult } from './mobile-work-result';

export function MobileWorkCard({presentation,onChange,focused=false,onFocus}:{presentation:WorkPresentation;onChange:(value:WorkPresentation)=>void;focused?:boolean;onFocus?:()=>void}) {
  const {item,latestResult,availableActions}=presentation;
  const shownResult=presentMobileWorkResult(presentation);
  const missingCompletedResult=describeMissingCompletedResult(presentation);
  const [detail,setDetail]=useState('');
  const [references,setReferences]=useState('');
  const [validations,setValidations]=useState('');
  const [limitations,setLimitations]=useState('');
  const [mode,setMode]=useState<'none'|'proposal_changes'|'result'|'result_changes'>('none');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  // Retomada executora pendente: a decisão foi salva no banco, mas a volta do
  // Supervisor no host falhou. Oferece um retry que aciona SOMENTE o host (a
  // decisão não é reenviada — sem 2º input_provided).
  const [resumeRetry,setResumeRetry]=useState(false);
  const allowed=(action:WorkPresentation['availableActions'][number])=>availableActions.includes(action);
  async function run(operation:Promise<WorkPresentation>){setBusy(true);setError('');try{onChange(await operation);setMode('none');setDetail('');setReferences('');setValidations('');setLimitations('');}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível atualizar o trabalho.');onChange(await reloadWork(item.id).catch(()=>presentation));}setBusy(false);}
  // Responde à decisão e, só quando o efeito é `resume` e o estado persistido é
  // `approved`, pede ao host UMA volta do Supervisor (retomada canônica pelo
  // checkpoint). O mobile não executa nada; relê a projeção persistida.
  async function onDecision(optionId:string){if(busy)return;setBusy(true);setError('');setResumeRetry(false);try{const{presentation:next,resumeRequested}=await respondWorkDecision(presentation,optionId);onChange(next);if(resumeRequested)await resumeOnHost(next);}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível registrar sua decisão.');onChange(await reloadWork(item.id).catch(()=>presentation));}setBusy(false);}
  async function resumeOnHost(current:WorkPresentation){try{onChange(await requestHostSupervisorTurn(current));setResumeRetry(false);}catch(cause){setResumeRetry(true);setError(cause instanceof Error?cause.message:'Sua decisão foi salva, mas não foi possível retomar o trabalho agora.');}}
  async function retryResume(){if(busy)return;setBusy(true);setError('');await resumeOnHost(presentation);setBusy(false);}
  const action=(label:string,onPress:()=>void)=><TouchableOpacity disabled={busy} onPress={onPress} style={styles.action}><Text style={styles.actionText}>{label}</Text></TouchableOpacity>;
  return <View style={styles.card}>
    <View style={styles.header}><Text style={styles.label}>{focused?'Trabalho em foco':'Trabalho'} · v{item.proposalVersion}</Text><Text style={styles.state}>{item.state}</Text></View>
    {!focused&&onFocus&&!['completed','failed','rejected','cancelled'].includes(item.state)&&action('Usar como foco',onFocus)}
    <Text style={styles.title}>{item.proposal.data.summary}</Text><Text style={styles.body}>{item.proposal.data.objective}</Text>
    <Text style={styles.state}>Riscos: {item.proposal.data.risks.length?item.proposal.data.risks.join('; '):'nenhum risco declarado'}</Text>
    {shownResult&&<View accessible accessibilityLabel={shownResult.accessibilityLabel} style={styles.result}>
      <Text style={styles.label}>{shownResult.title}</Text>
      <Text style={styles.body}>{shownResult.summary}</Text>
      <Text style={styles.state}>Referências: {shownResult.references}</Text>
      <Text style={styles.state}>Validações: {shownResult.validations}</Text>
      <Text style={styles.state}>Limitações: {shownResult.limitations}</Text>
      {shownResult.completionMessage&&<Text accessibilityLiveRegion="polite" style={styles.completed}>{shownResult.completionMessage}</Text>}
    </View>}
    {missingCompletedResult&&<Text accessibilityRole="alert" style={styles.error}>{missingCompletedResult}</Text>}
    {presentation.pendingDecision&&<View accessible accessibilityLabel="Decisão necessária" style={styles.result}>
      <Text style={styles.label}>Preciso da sua decisão</Text>
      <Text style={styles.body}>{presentation.pendingDecision.explanation}</Text>
      <Text style={styles.state}>O trabalho está pausado em um checkpoint seguro.</Text>
      <View style={styles.actions}>{presentation.pendingDecision.options.map(option=><TouchableOpacity key={option.id} disabled={busy} onPress={()=>void onDecision(option.id)} style={styles.action}><Text style={styles.actionText}>{option.label}</Text></TouchableOpacity>)}</View>
    </View>}
    {presentation.integration&&<View accessible accessibilityLabel="Decisão de integração" style={styles.result}>
      <Text style={styles.label}>{presentation.integration.status==='awaiting_decision'?'Integração aguardando sua decisão':presentation.integration.status==='authorized'?'Integração autorizada':'Integração recusada'}</Text>
      <Text style={styles.body}>{presentation.integration.status==='awaiting_decision'?'Autorizar permite uma futura execução protegida; não publica, envia, cria PR ou integra agora.':presentation.integration.status==='authorized'?'Autorizada e aguardando execução protegida. Nada foi publicado, enviado, integrado ou mergeado.':'A integração deste resultado foi recusada. Nenhum efeito externo ocorreu.'}</Text>
      {presentation.integration.availableDecisions.length>0&&<View style={styles.actions}>{action('Autorizar integração',()=>void run(decideWorkIntegration(presentation,'authorize')))}{action('Recusar integração',()=>void run(decideWorkIntegration(presentation,'refuse')))}</View>}
    </View>}
    {resumeRetry&&<View accessible accessibilityLabel="Retomar no host" style={styles.actions}><TouchableOpacity disabled={busy} onPress={()=>void retryResume()} style={styles.action}><Text style={styles.actionText}>Retomar no host</Text></TouchableOpacity></View>}
    {mode==='none'&&allowed('approve')&&<View style={styles.actions}>{action('Aprovar',()=>void run(decideWork(presentation,{type:'approve'})))}{action('Corrigir',()=>setMode('proposal_changes'))}{action('Adiar',()=>void run(decideWork(presentation,{type:'defer',reason:'Adiado no mobile'})))}{action('Rejeitar',()=>void run(decideWork(presentation,{type:'reject'})))}</View>}
    {mode==='proposal_changes'&&<Editor value={detail} onChange={setDetail} label="Correção da proposta" onConfirm={()=>void run(requestProposalCorrection(presentation,detail.trim()))} />}
    {mode==='none'&&!presentation.pendingDecision&&allowed('start')&&action(item.state==='approved'?'Iniciar':'Retomar',()=>void run(startWork(presentation)))}
    {mode==='none'&&allowed('submit_result')&&action('Registrar resultado',()=>setMode('result'))}
    {mode==='result'&&<View>
      <TextInput accessibilityLabel="Resumo do resultado" value={detail} onChangeText={setDetail} placeholder="Resumo do resultado" placeholderTextColor={colors.textMuted} style={styles.input} multiline/>
      <TextInput accessibilityLabel="Referências produzidas" value={references} onChangeText={setReferences} placeholder="Referências, uma por linha" placeholderTextColor={colors.textMuted} style={styles.input} multiline/>
      <TextInput accessibilityLabel="Validações executadas" value={validations} onChangeText={setValidations} placeholder="Validações, uma por linha (ok: / falha:)" placeholderTextColor={colors.textMuted} style={styles.input} multiline/>
      <TextInput accessibilityLabel="Limitações conhecidas" value={limitations} onChangeText={setLimitations} placeholder="Limitações, uma por linha" placeholderTextColor={colors.textMuted} style={styles.input} multiline/>
      <TouchableOpacity disabled={!detail.trim()||busy} onPress={()=>void run(submitWorkResult(presentation,detail.trim(),references.split('\n').map(value=>value.trim()).filter(Boolean),parseWorkResultValidations(validations),limitations.split('\n').map(value=>value.trim()).filter(Boolean)))} style={styles.action}><Text style={styles.actionText}>Confirmar</Text></TouchableOpacity>
    </View>}
    {mode==='none'&&allowed('accept_result')&&latestResult&&<View style={styles.actions}>{action(`Aceitar resultado v${latestResult.proposalVersion}`,()=>void run(reviewWorkResult(presentation,{type:'accept'})))}{action('Pedir correções',()=>setMode('result_changes'))}</View>}
    {mode==='result_changes'&&<Editor value={detail} onChange={setDetail} label="Correções necessárias" onConfirm={()=>void run(reviewWorkResult(presentation,{type:'request_changes',requestedChanges:detail.trim()}))} />}
    {error?<Text style={styles.error}>{error}</Text>:null}
  </View>;
}
function Editor({value,onChange,label,onConfirm}:{value:string;onChange:(value:string)=>void;label:string;onConfirm:()=>void}){return <View><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={label} placeholderTextColor={colors.textMuted} style={styles.input} multiline/><TouchableOpacity disabled={!value.trim()} onPress={onConfirm} style={styles.action}><Text style={styles.actionText}>Confirmar</Text></TouchableOpacity></View>}
const styles=StyleSheet.create({card:{marginTop:spacing.xs,padding:spacing.sm,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,backgroundColor:colors.bgSurface,gap:spacing.xs,maxWidth:'92%'},header:{flexDirection:'row',justifyContent:'space-between'},label:{fontSize:12,fontWeight:'700',color:colors.accent},state:{fontSize:12,color:colors.textMuted},title:{fontSize:14,fontWeight:'700',color:colors.textPrimary},body:{fontSize:13,color:colors.textMuted},result:{borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,padding:spacing.xs,gap:2},completed:{fontSize:12,fontWeight:'600',color:colors.textPrimary,marginTop:spacing.xs},actions:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs},action:{paddingVertical:6,paddingHorizontal:10,borderRadius:radius.sm,backgroundColor:colors.bgElevated,alignSelf:'flex-start'},actionText:{fontSize:12,color:colors.textPrimary},input:{borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,color:colors.textPrimary,padding:8,minHeight:54,marginBottom:spacing.xs},error:{fontSize:12,color:'#e5484d'}});
