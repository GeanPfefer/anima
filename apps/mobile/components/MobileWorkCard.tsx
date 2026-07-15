import { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import type { WorkItem } from '@anima/core';
import { decideWork, requestProposalCorrection, reviewWorkResult, startWork, submitWorkResult } from '@/lib/mobile-work';
import { colors, radius, spacing } from '@/constants/theme';

export function MobileWorkCard({item,onChange}:{item:WorkItem;onChange:(item:WorkItem)=>void}) {
  const [detail,setDetail]=useState('');
  const [mode,setMode]=useState<'none'|'proposal_changes'|'result'|'result_changes'>('none');
  const [busy,setBusy]=useState(false);
  async function run(operation:Promise<WorkItem|null>){setBusy(true);const next=await operation.catch(()=>null);if(next)onChange(next);setBusy(false);setMode('none');setDetail('');}
  const action=(label:string,onPress:()=>void)=><TouchableOpacity disabled={busy} onPress={onPress} style={styles.action}><Text style={styles.actionText}>{label}</Text></TouchableOpacity>;
  return <View style={styles.card}>
    <View style={styles.header}><Text style={styles.label}>Trabalho · v{item.proposalVersion}</Text><Text style={styles.state}>{item.state}</Text></View>
    <Text style={styles.title}>{item.proposal.data.summary}</Text><Text style={styles.body}>{item.proposal.data.objective}</Text>
    {item.state==='proposed'&&mode==='none'&&<View style={styles.actions}>{action('Aprovar',()=>void run(decideWork(item,{type:'approve'})))}{action('Corrigir',()=>setMode('proposal_changes'))}{action('Adiar',()=>void run(decideWork(item,{type:'defer',reason:'Adiado no mobile'})))}{action('Rejeitar',()=>void run(decideWork(item,{type:'reject'})))}</View>}
    {mode==='proposal_changes'&&<Editor value={detail} onChange={setDetail} label="Correção da proposta" onConfirm={()=>void run(requestProposalCorrection(item,detail.trim()))} />}
    {(item.state==='approved'||item.state==='changes_requested')&&action(item.state==='approved'?'Iniciar':'Retomar',()=>void run(startWork(item)))}
    {item.state==='in_progress'&&mode==='none'&&action('Registrar resultado',()=>setMode('result'))}
    {mode==='result'&&<Editor value={detail} onChange={setDetail} label="Resumo do resultado" onConfirm={()=>void run(submitWorkResult(item,detail.trim(),[]))} />}
    {item.state==='review'&&mode==='none'&&<View style={styles.actions}>{action('Aceitar resultado',()=>void run(reviewWorkResult(item,{type:'accept'})))}{action('Pedir correções',()=>setMode('result_changes'))}</View>}
    {mode==='result_changes'&&<Editor value={detail} onChange={setDetail} label="Correções necessárias" onConfirm={()=>void run(reviewWorkResult(item,{type:'request_changes',requestedChanges:detail.trim()}))} />}
  </View>;
}
function Editor({value,onChange,label,onConfirm}:{value:string;onChange:(value:string)=>void;label:string;onConfirm:()=>void}){return <View><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={label} placeholderTextColor={colors.textMuted} style={styles.input} multiline/><TouchableOpacity disabled={!value.trim()} onPress={onConfirm} style={styles.action}><Text style={styles.actionText}>Confirmar</Text></TouchableOpacity></View>}
const styles=StyleSheet.create({card:{marginTop:spacing.xs,padding:spacing.sm,borderWidth:1,borderColor:colors.border,borderRadius:radius.md,backgroundColor:colors.bgSurface,gap:spacing.xs,maxWidth:'92%'},header:{flexDirection:'row',justifyContent:'space-between'},label:{fontSize:12,fontWeight:'700',color:colors.accent},state:{fontSize:12,color:colors.textMuted},title:{fontSize:14,fontWeight:'700',color:colors.textPrimary},body:{fontSize:13,color:colors.textMuted},actions:{flexDirection:'row',flexWrap:'wrap',gap:spacing.xs},action:{paddingVertical:6,paddingHorizontal:10,borderRadius:radius.sm,backgroundColor:colors.bgElevated,alignSelf:'flex-start'},actionText:{fontSize:12,color:colors.textPrimary},input:{borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,color:colors.textPrimary,padding:8,minHeight:54,marginBottom:spacing.xs}});
