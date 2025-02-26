<template>
    <q-card class="cvsscalculator">
        <q-card-section class="row">
            <div class="col-md-3" style="align-self:center">
            <span>
                {{$t('cvss.title')}}
                <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                    <span :style="tooltip.style">{{$t('cvss.tooltip.baseMetricGroup_Legend')}}</span>
                </q-tooltip>
            </span>
            </div>
            <q-space />
            <div v-if="cvss.baseImpact && cvss.baseExploitability" style="margin-right:120px">
                <q-chip square color="blue-12" text-color="white">{{$t('cvss.impactSubscore')}}:&nbsp;<span class="text-bold">{{roundUp1(cvss.baseImpact)}}</span></q-chip>
                <q-chip square color="blue-12" text-color="white">{{$t('cvss.exploitabilitySubscore')}}:&nbsp;<span class="text-bold">{{roundUp1(cvss.baseExploitability)}}</span></q-chip>
            </div>
            <div class="scoreRating" :class="cvss.baseSeverity">
                <span class="baseSeverity" v-if="!cvss.baseMetricScore">{{$t('cvss.infoWhenNoScore')}}</span>
                <div v-else>
                    <span class="baseMetricScore">{{cvss.baseMetricScore}}</span>
                    <span class="baseSeverity">({{cvss.baseSeverity}})</span>
                </div>
            </div>
        </q-card-section>
        <q-separator />
        <q-card-section class="row q-col-gutter-md">
            <div class="col-md-6">
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.attackVector')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.AV_Heading')}}</span>
                        </q-tooltip>
                    </span>
                </div>
                
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.AV"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.AV || []"
                    :readonly="readonly"
                >
                <template v-slot:one>
                    <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                        <span :style="tooltip.style">{{$t('cvss.tooltip.AV_N_Label')}}</span>
                    </q-tooltip>
                </template>
                <template v-slot:two>
                    <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                        <span :style="tooltip.style">{{$t('cvss.tooltip.AV_A_Label')}}</span>
                    </q-tooltip>
                </template>
                <template v-slot:three>
                    <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                        <span :style="tooltip.style">{{$t('cvss.tooltip.AV_L_Label')}}</span>
                    </q-tooltip>
                </template>
                <template v-slot:four>
                    <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                        <span :style="tooltip.style">{{$t('cvss.tooltip.AV_P_Label')}}</span>
                    </q-tooltip>
                </template>
                </q-btn-toggle>
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.attackComplexity')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.AC_Heading')}}</span>
                        </q-tooltip>
                    </span>
                </div>
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.AC"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.AC  || []"
                    :readonly="readonly"
                >
                    <template v-slot:one>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.AC_L_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:two>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.AC_H_Label')}}</span>
                        </q-tooltip>
                    </template>
                </q-btn-toggle>
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.privilegesRequired')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.PR_Heading')}}</span>
                        </q-tooltip>
                    </span>
                </div>
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.PR"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.PR  || []"
                    :readonly="readonly"
                >
                    <template v-slot:one>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.PR_N_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:two>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.PR_L_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:three>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.PR_H_Label')}}</span>
                        </q-tooltip>
                    </template>
                </q-btn-toggle>
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.userInteraction')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.UI_Heading')}}</span>
                        </q-tooltip>
                    </span>
                </div>
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.UI"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.UI  || []"
                    :readonly="readonly"
                >
                    <template v-slot:one>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.UI_N_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:two>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.UI_R_Label')}}</span>
                        </q-tooltip>
                    </template>
                </q-btn-toggle>
            </div>
            <div class="col-md-6">
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.scope')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.S_Heading')}}</span>
                        </q-tooltip>
                    </span>
                </div>
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.S"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.S  || []"
                    :readonly="readonly"
                >
                    <template v-slot:one>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.S_U_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:two>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.S_C_Label')}}</span>
                        </q-tooltip>
                    </template>
                </q-btn-toggle>
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.confidentialityImpact')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.C_Heading')}}</span>
                        </q-tooltip>
                    </span>        
                </div>
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.C"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.C  || []"
                    :readonly="readonly"
                >
                    <template v-slot:one>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.C_N_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:two>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.C_L_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:three>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.C_H_Label')}}</span>
                        </q-tooltip>
                    </template>
                </q-btn-toggle>
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.integrityImpact')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.I_Heading')}}</span>
                        </q-tooltip>
                    </span>        
                </div>
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.I"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.I || [] "
                    :readonly="readonly"
                >
                    <template v-slot:one>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.I_N_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:two>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.I_L_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:three>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.I_H_Label')}}</span>
                        </q-tooltip>
                    </template>
                </q-btn-toggle>
                <div class="q-my-sm text-weight-bold">
                    <span>
                        {{$t('cvss.availabilityImpact')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.A_Heading')}}</span>
                        </q-tooltip>
                    </span>        
                </div>
                <q-btn-toggle
                    class="group-btn"
                    v-model="cvssObj.A"
                    toggle-color="grey-5"
                    toggle-text-color="black"
                    no-caps
                    :options="cvssItems.A || [] "
                    :readonly="readonly"
                >
                    <template v-slot:one>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.A_N_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:two>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.A_L_Label')}}</span>
                        </q-tooltip>
                    </template>
                    <template v-slot:three>
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.A_H_Label')}}</span>
                        </q-tooltip>
                    </template>
                </q-btn-toggle>
            </div>
        </q-card-section>
        <q-expansion-item 
        :default-opened="$settings.report.public.extendCvssTemporalEnvironment"
        :label="$t('cvss.temporalEnvironmentalTitle')"
        header-class="bg-blue-grey-5 text-white" 
        expand-icon-class="text-white">
            <q-card-section class="row">
            <div class="col-md-6">
                <span>
                {{$t('cvss.temporalTitle')}}
                <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                    <span :style="tooltip.style">{{$t('cvss.tooltip.temporalMetricGroup_Legend')}}</span>
                </q-tooltip>
                </span>
            </div>
            <q-space />
            <div class="scoreRating" :class="cvss.temporalSeverity">
                <span class="baseSeverity" v-if="!cvss.temporalMetricScore">{{$t('cvss.infoWhenNoScore')}}</span>
                <div v-else>
                    <span class="baseMetricScore">{{cvss.temporalMetricScore}}</span>
                    <span class="baseSeverity">({{cvss.temporalSeverity}})</span>
                </div>
            </div>
            </q-card-section>
            <q-separator />
            <q-card-section class="row q-col-gutter-md">
                <div class="col">
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.exploitCodeMaturity')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.E_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.E"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.E || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.E_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.E_U_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.E_P_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.E_F_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:five>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.E_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.remediationLevel')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RL_Heading')}}</span>
                            </q-tooltip>
                        </span>        
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.RL"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.RL || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RL_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RL_O_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RL_T_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RL_W_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:five>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RL_U_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.reportConfidence')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RC_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.RC"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.RC || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RC_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RC_U_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RC_R_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.RC_C_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                </div>
            </q-card-section>
            <q-separator />
            <q-card-section class="row">
                <div class="col-md-3" style="align-self:center">
                    <span>
                        {{$t('cvss.environmentalTitle')}}
                        <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                            <span :style="tooltip.style">{{$t('cvss.tooltip.environmentalMetricGroup_Legend')}}</span>
                        </q-tooltip>
                    </span>
                </div>
                <q-space />
                <div v-if="cvss.baseImpact && cvss.baseExploitability" style="margin-right:120px">
                    <q-chip square color="blue-12" text-color="white">{{$t('cvss.environmentalModifiedImpact')}}:&nbsp;<span class="text-bold">{{roundUp1(cvss.environmentalModifiedImpact)}}</span></q-chip>
                    <q-chip square color="blue-12" text-color="white">{{$t('cvss.environmentalModifiedExploitability')}}:&nbsp;<span class="text-bold">{{roundUp1(cvss.environmentalModifiedExploitability)}}</span></q-chip>
                </div>
                <div class="scoreRating" :class="cvss.environmentalSeverity">
                    <span class="baseSeverity" v-if="!cvss.environmentalMetricScore">{{$t('cvss.infoWhenNoScore')}}</span>
                    <div v-else>
                        <span class="baseMetricScore">{{cvss.environmentalMetricScore}}</span>
                        <span class="baseSeverity">({{cvss.environmentalSeverity}})</span>
                    </div>
                </div>
            </q-card-section>
            <q-separator />
            <q-card-section class="row q-col-gutter-md">
                <div class="col-md-6">
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.confidentialityRequirement')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.CR_Heading')}}</span>
                            </q-tooltip>
                        </span>        
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.CR"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.CR || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.CR_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.CR_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.CR_M_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.CR_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.integrityRequirement')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.IR_Heading')}}</span>
                            </q-tooltip>
                        </span>  
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.IR"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.IR || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.IR_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.IR_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.IR_M_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.IR_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.availabilityRequirement')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.AR_Heading')}}</span>
                            </q-tooltip>
                        </span>  
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.AR"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.AR || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.AR_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.AR_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.AR_M_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.AR_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                </div>
                <div class="col-md-6">
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedAttackVector')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAV_Heading')}}</span>
                            </q-tooltip>
                        </span>        
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MAV"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MAV || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAV_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAV_N_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAV_A_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAV_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:five>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAV_P_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedAttackComplexity')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAC_Heading')}}</span>
                            </q-tooltip>
                        </span>        
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MAC"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MAC || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAC_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAC_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MAC_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedPrivilegesRequired')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MPR_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MPR"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MPR || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MPR_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MPR_N_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MPR_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MPR_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedUserInteraction')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MUI_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MUI"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MUI || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MUI_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MUI_N_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MUI_R_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedScope')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MS_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MS"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MS || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MS_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MS_U_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MS_C_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedConfidentialityImpact')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MC_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MC"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MC || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MC_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MC_N_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MC_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MC_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedIntegrityImpact')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MI_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MI"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MI || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MI_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MI_N_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MI_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MI_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                    <div class="q-my-sm text-weight-bold">
                        <span>
                            {{$t('cvss.modifiedAvailabilityImpact')}}
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MA_Heading')}}</span>
                            </q-tooltip>
                        </span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvssObj.MA"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvssItems.MA || [] "
                        :readonly="readonly"
                    >
                        <template v-slot:one>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MA_X_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:two>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MA_N_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:three>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MA_L_Label')}}</span>
                            </q-tooltip>
                        </template>
                        <template v-slot:four>
                            <q-tooltip :anchor="tooltip.anchor" :self="tooltip.self" :delay="tooltip.delay" :max-width="tooltip.maxWidth">
                                <span :style="tooltip.style">{{$t('cvss.tooltip.MA_H_Label')}}</span>
                            </q-tooltip>
                        </template>
                    </q-btn-toggle>
                </div>
            </q-card-section>
        </q-expansion-item>
    </q-card>
</template>

<script>
import { defineComponent } from 'vue';
import { $t } from '@/boot/i18n';

export default defineComponent({
  emits: ['update:modelValue'],
  name: 'cvss-calculator',
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    readonly: {
      type: Boolean,
      default: false
    }
  },

  data() {
    return {
        cvssItems: {
            AV: [ { label: 'Network', value: 'N' }, { label: 'Adjacent', value: 'A' }, { label: 'Local', value: 'L' }, { label: 'Physical', value: 'P' } ],
            AC: [ { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            PR: [ { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            UI: [ { label: 'None', value: 'N' }, { label: 'Required', value: 'R' } ],
            S: [ { label: 'Unchanged', value: 'U' }, { label: 'Changed', value: 'C' } ],
            C: [ { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            I: [ { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            A: [ { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            
            // Options manquantes pour Temporal et Environmental
            E: [ { label: 'Not Defined', value: 'X' }, { label: 'Unproven', value: 'U' }, { label: 'Proof-of-Concept', value: 'P' }, { label: 'Functional', value: 'F' }, { label: 'High', value: 'H' } ],
            RL: [ { label: 'Not Defined', value: 'X' }, { label: 'Official Fix', value: 'O' }, { label: 'Temporary Fix', value: 'T' }, { label: 'Workaround', value: 'W' }, { label: 'Unavailable', value: 'U' } ],
            RC: [ { label: 'Not Defined', value: 'X' }, { label: 'Unknown', value: 'U' }, { label: 'Reasonable', value: 'R' }, { label: 'Confirmed', value: 'C' } ],
            
            CR: [ { label: 'Not Defined', value: 'X' }, { label: 'Low', value: 'L' }, { label: 'Medium', value: 'M' }, { label: 'High', value: 'H' } ],
            IR: [ { label: 'Not Defined', value: 'X' }, { label: 'Low', value: 'L' }, { label: 'Medium', value: 'M' }, { label: 'High', value: 'H' } ],
            AR: [ { label: 'Not Defined', value: 'X' }, { label: 'Low', value: 'L' }, { label: 'Medium', value: 'M' }, { label: 'High', value: 'H' } ],
            
            MAV: [ { label: 'Not Defined', value: 'X' }, { label: 'Network', value: 'N' }, { label: 'Adjacent', value: 'A' }, { label: 'Local', value: 'L' }, { label: 'Physical', value: 'P' } ],
            MAC: [ { label: 'Not Defined', value: 'X' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            MPR: [ { label: 'Not Defined', value: 'X' }, { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            MUI: [ { label: 'Not Defined', value: 'X' }, { label: 'None', value: 'N' }, { label: 'Required', value: 'R' } ],
            MS: [ { label: 'Not Defined', value: 'X' }, { label: 'Unchanged', value: 'U' }, { label: 'Changed', value: 'C' } ],
            MC: [ { label: 'Not Defined', value: 'X' }, { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            MI: [ { label: 'Not Defined', value: 'X' }, { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ],
            MA: [ { label: 'Not Defined', value: 'X' }, { label: 'None', value: 'N' }, { label: 'Low', value: 'L' }, { label: 'High', value: 'H' } ]
        },


      cvssObj: {version:'3.1', AV:'', AC:'', PR:'', UI:'', S:'', C:'', I:'', A:'', E:'', RL:'', RC:'', CR:'', IR:'', AR:'', MAV:'', MAC:'', MPR:'', MUI:'', MS:'', MC:'', MI:'', MA:''},
      cvss: {
        baseMetricScore: '',
        baseSeverity: '',
        temporalMetricScore: '',
        temporalSeverity: '',
        environmentalMetricScore: '',
        environmentalSeverity: ''
      },
      tooltip: {
        anchor: 'bottom middle',
        self: 'top left',
        delay: 500,
        maxWidth: '700px',
        class: '',
        style: 'font-size: 12px'
      }
    };
  },

  created() {
    this.cvssStrToObject(this.modelValue);
    this.cvss = CVSS31.calculateCVSSFromVector(this.modelValue);
  },

  watch: {
    modelValue(val) {
      this.cvssStrToObject(val);
      this.cvss = CVSS31.calculateCVSSFromVector(val);
    },
    cvssObj: {
      handler() {
        this.cvssObjectToStr();
      },
      deep: true
    }
  },

  methods: {
    roundUp1(n) {
      return CVSS31.roundUp1(n);
    },

    cvssStrToObject(str) {
      if (str) {
        const temp = str.split('/');
        for (let i = 0; i < temp.length; i++) {
          const elt = temp[i].split(':');
          if (this.cvssObj.hasOwnProperty(elt[0])) {
            this.cvssObj[elt[0]] = elt[1] || '';
          }
        }
      }
    },

    cvssObjectToStr() {
      let vectorString = 'CVSS:' + this.cvssObj.version;
      for (const key in this.cvssObj) {
        if (key !== 'version' && this.cvssObj[key]) {
          vectorString += `/${key}:${this.cvssObj[key]}`;
        }
      }

      this.cvss = CVSS31.calculateCVSSFromVector(vectorString);
      this.$emit('update:modelValue', vectorString);
    }
  }
});

</script>

<style>
    .group-btn .q-btn {
        border: 1px solid #ccc;
    }

    .group-btn .q-btn-inner div {
        font-weight: 400;
    }

    .baseSeverity {
        font-size: 16px;
        font-weight: normal;
        margin-bottom: 5px;
        display: block;
    }

    .baseMetricScore {
        display: block;
        font-size: 32px;
        line-height: 32px;
        font-weight: normal;
        margin-top: 4px;
    }

    .scoreRating {
        width: 100px;
        top: -4px;
        right: 20px;
        border: 2px solid #666666;
        background: #dddddd;
        font-size: 11px;
        border-radius: 10px;
        line-height: 150%;
        text-align: center;
        height: fit-content!important;
        position: absolute;
    }

    .scoreRating.None {
        background: #53aa33;
        border: 2px solid #53aa33;
        color: white;
    }

    .scoreRating.Low {
        background: #ffcb0d;
        border: 2px solid #ffcb0d;
        color: white;
    }

    .scoreRating.Medium {
        background: #f9a009;
        border: 2px solid #f9a009;
        color: white;
    }

    .scoreRating.High {
        background: #df3d03;
        border: 2px solid #df3d03;
        color: white;
    }

    .scoreRating.Critical {
        background: #212121;
        border: 2px solid #212121;
        color: white;
    }
</style>
