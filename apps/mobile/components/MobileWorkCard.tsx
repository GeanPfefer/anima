import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import type { WorkPresentation } from '@anima/core';
import { decideWork, requestProposalCorrection, reviewWorkResult, startWork, submitWorkResult } from '@/lib/mobile-work';
import { colors, radius, spacing } from '@/constants/theme';

export function MobileWorkCard({presentation,onChange}:{presentation:WorkPresentation;onChange:(value:WorkPresentation)=>void}) {
  const {item,latestResult,availableActions}=presentation;
  const [detail,setDetail]=useState('');
  const [mode,setMode]=useState<'none'|'proposal_changes'|'result'|'result_changes'>('none');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const allowed=(action:WorkPresentation['availableActions'][number])=>availableActions.includes(action);
  async function run(operation:Promise<WorkPresentation>){setBusy(true);setError('');try{onChange(await operation);setMode('none');setDetail('');}catch(cause){setError(cause instanceof Error?cause.message:'Não foi possível atualizar o trabalho.');}setBusy(false);}
  const action=(label:string,onPress:()=>void)=><TouchableOpacity disabled={busy} onPress={onPress} style={styles.action}><Text style={styles.actionText}>{label}</Text></TouchableOpacity>;
  return <View style={styles.card}>
    <View style={styles.header}><Text style={styles.label}>Trabalho · v{item.proposalVersion}</Text><Text style={styles.state}>{item.state}</Text></View>
    <Text style={styles.title}>{item.proposal.data.summary}</Text><Text style={styles.body}>{item.proposal.data.objective}</Text>
    {item.state==='review'&&latestResult&&<View accessibilityLabel="Resultado para revisão" style={styles.result}><Text style={styles.label}>Resultado · v{latestResult.proposalVersion} · {latestResult.author}</Text><Text style={styles.body}>{latestResult.summary}</Text><Text style={styles.state}>{latestResult.references.length?latestResult.references.join(', '):'Nenhuma referência'}</Text></View>}
    {mode==='none'&&allowed('approve')&&<View style={styles.actions}>{action('Aprovar',()=>void run(decideWork(presentation,{type:'approve'})))}{action('Corrigir',()=>setMode('proposal_changes'))}{action('Adiar',()=>void run(decideWork(presentation,{type:'defer',reason:'Adiado no mobile'})))}{action('Rejeitar',()=>void run(decideWork(presentation,{type:'reject'})))}</View>}
    {mode==='proposal_changes'&&<Editor value={detail} onChange={setDetail} label="Correção da proposta" onConfirm={()=>void run(requestProposalCorrection(presentation,detail.trim()))} />}
    {mode==='none'&&allowed('start')&&action(item.state==='approved'?'Iniciar':'Retomar',()=>void run(startWork(presentation)))}
    {mode==='none'&&allowed('submit_result')&&action('Registrar resultado',()=>setMode('result'))}
    {mode==='result'&&<Editor value={detail} onChange={setDetail} label="Resumo do resultado" onConfirm={()=>void run(submitWorkResult(presentation,detail.trim(),[]))} />}
    {mode==='none'&&allowed('accept_result')&&latestResult&&<View style={styles.actions}>{action(`Aceitar resultado v${latestResult.proposalVersion}`,()=>void run(reviewWorkResult(presentation,{type:'accept'})))}{action('Pedir correções',()=>setMode('result_changes'))}</View>}
    {mode==='result_changes'&&<Editor value={detail} onChange={setDetail} label="Correções necessárias" onConfirm={()=>void run(reviewWorkResult(presentation,{type:'request_changes',requestedChanges:detail.trim()}))} />}
    {error?<Text style={styles.error}>{error}</Text>:null}
  </View>;
}
function Editor({value,onChange,label,onConfirm}:{value:string;onChange:(value:string)=>void;label:string;onConfirm:()=>void}){return <View><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={label} placeholderTextColor={colors.textMuted} style={styles.input} multiline/><TouchableOpacity disabled={!value.trim()} onPress={onConfirm} style={styles.action}><Text style={styles.actionText}>Confirmar</Text></TouchableOpacity></View>}
const styles=StyleSheet.create({card:{marginTop:spacing.xs,padding:spacing.sm,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,backgroundColor:colors.bgSurface,gap:spacing.xs,maxWidth:'92%'},header:{flexDirection:'row',justifyContent:'space-between'},label:{fontSize:12,fontWeight:'700',color:colors.accent},state:{fontSize:12,color:colors.textMuted},title:{fontSize:14,fontWeight:'700',color:colors.textPrimary},body:{fontSize:13,color:colors.textMuted},result:{borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,padding:spacing.xs,gap:2},actions:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs},action:{paddingVertical:6,paddingHorizontal:10,borderRadius:radius.sm,backgroundColor:colors.bgElevated,alignSelf:'flex-start'},actionText:{fontSize:12,color:colors.textPrimary},input:{borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,color:colors.textPrimary,padding:8,minHeight:54,marginBottom:spacing.xs},error:{fontSize:12,color:'#e5484d'}});
