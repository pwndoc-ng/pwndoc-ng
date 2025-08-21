<template>
    <div>
        <!-- Version Selector -->
        <q-card class="q-mb-sm">
            <q-card-section class="row items-center q-pb-sm">
                <q-select
                    v-model="cvssVersion"
                    :options="versionOptions"
                    option-label="label"
                    option-value="value"
                    emit-value
                    map-options
                    label="Version CVSS"
                    outlined
                    dense
                    style="min-width: 150px"
                    @update:model-value="onVersionChange"
                />
                <q-space />
            </q-card-section>
        </q-card>

        <!-- CVSS 3.1 Component -->
        <cvss-calculator 
            v-if="cvssVersion === '3.1'"
            :model-value="internalCvss3Vector"
            :readonly="readonly"
            @update:model-value="onCvss3Change"
        />

        <!-- CVSS 4.0 Component -->
        <q-card v-else-if="cvssVersion === '4.0'" class="cvsscalculator">
            <q-card-section class="row">
                <div class="col-md-3" style="align-self:center">
                    <span>
                        CVSS 4.0
                        <q-tooltip anchor="top middle" self="bottom middle" :delay="500" max-width="300px">
                            <span style="white-space: pre-wrap">Common Vulnerability Scoring System version 4.0</span>
                        </q-tooltip>
                    </span>
                </div>
                <q-space />
                <div v-if="cvss40.exploitability && cvss40.vulnerableSystemImpact" style="margin-right:120px">
                    <q-chip square color="blue-12" text-color="white">Exploitability:&nbsp;<span class="text-bold">{{roundUp1(cvss40.exploitability)}}</span></q-chip>
                    <q-chip square color="blue-12" text-color="white">Impact:&nbsp;<span class="text-bold">{{roundUp1(cvss40.vulnerableSystemImpact)}}</span></q-chip>
                </div>
                <div class="scoreRating" :class="cvss40.baseSeverity">
                    <span class="baseSeverity" v-if="!cvss40.baseMetricScore">Sélectionnez les métriques</span>
                    <div v-else>
                        <span class="baseMetricScore">{{cvss40.baseMetricScore}}</span>
                        <span class="baseSeverity">({{cvss40.baseSeverity}})</span>
                    </div>
                </div>
            </q-card-section>
            <q-separator />
            
            <!-- Base Metrics CVSS 4.0 -->
            <q-card-section class="row q-col-gutter-md">
                <div class="col-md-6">
                    <!-- Attack Vector -->
                    <div class="q-my-sm text-weight-bold">
                        <span>Vecteur d'Attaque (AV)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.AV"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.AV || []"
                        :readonly="readonly"
                    />

                    <!-- Attack Complexity -->
                    <div class="q-my-sm text-weight-bold">
                        <span>Complexité d'Attaque (AC)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.AC"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.AC || []"
                        :readonly="readonly"
                    />

                    <!-- Attack Requirements (NEW in 4.0) -->
                    <div class="q-my-sm text-weight-bold">
                        <span>Exigences d'Attaque (AT)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.AT"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.AT || []"
                        :readonly="readonly"
                    />

                    <!-- Privileges Required -->
                    <div class="q-my-sm text-weight-bold">
                        <span>Privilèges Requis (PR)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.PR"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.PR || []"
                        :readonly="readonly"
                    />

                    <!-- User Interaction (UPDATED in 4.0) -->
                    <div class="q-my-sm text-weight-bold">
                        <span>Interaction Utilisateur (UI)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.UI"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.UI || []"
                        :readonly="readonly"
                    />
                </div>
                
                <div class="col-md-6">
                    <!-- Vulnerable System Impact -->
                    <div class="text-h6 q-mb-md text-primary">Impact Système Vulnérable</div>
                    
                    <div class="q-my-sm text-weight-bold">
                        <span>Confidentialité (VC)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.VC"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.VC || []"
                        :readonly="readonly"
                    />

                    <div class="q-my-sm text-weight-bold">
                        <span>Intégrité (VI)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.VI"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.VI || []"
                        :readonly="readonly"
                    />

                    <div class="q-my-sm text-weight-bold">
                        <span>Disponibilité (VA)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.VA"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.VA || []"
                        :readonly="readonly"
                    />

                    <!-- Subsequent Systems Impact (NEW in 4.0) -->
                    <div class="text-h6 q-mb-md text-secondary q-mt-lg">
                        Impact Systèmes Subséquents
                    </div>
                    
                    <div class="q-my-sm text-weight-bold">
                        <span>Confidentialité (SC)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.SC"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.SC || []"
                        :readonly="readonly"
                    />

                    <div class="q-my-sm text-weight-bold">
                        <span>Intégrité (SI)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.SI"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.SI || []"
                        :readonly="readonly"
                    />

                    <div class="q-my-sm text-weight-bold">
                        <span>Disponibilité (SA)</span>
                    </div>
                    <q-btn-toggle
                        class="group-btn"
                        v-model="cvss40Obj.SA"
                        toggle-color="grey-5"
                        toggle-text-color="black"
                        no-caps
                        :options="cvss40Items.SA || []"
                        :readonly="readonly"
                    />
                </div>
            </q-card-section>

            <!-- Threat and Environmental Metrics for CVSS 4.0 -->
            <q-expansion-item 
                :default-opened="false"
                label="Métriques de Menace et Environnementales CVSS 4.0"
                header-class="bg-blue-grey-5 text-white" 
                expand-icon-class="text-white">
                
                <q-card-section class="row">
                    <div class="col-md-6">
                        <span class="text-h6">Métriques de Menace</span>
                    </div>
                    <q-space />
                    <div class="scoreRating" :class="cvss40.threatSeverity">
                        <span class="baseSeverity" v-if="!cvss40.threatMetricScore">Score de menace</span>
                        <div v-else>
                            <span class="baseMetricScore">{{cvss40.threatMetricScore}}</span>
                            <span class="baseSeverity">({{cvss40.threatSeverity}})</span>
                        </div>
                    </div>
                </q-card-section>
                <q-separator />
                
                <q-card-section class="row q-col-gutter-md">
                    <div class="col">
                        <!-- Exploit Maturity -->
                        <div class="q-my-sm text-weight-bold">
                            <span>Maturité d'Exploitation (E)</span>
                        </div>
                        <q-btn-toggle
                            class="group-btn"
                            v-model="cvss40Obj.E"
                            toggle-color="grey-5"
                            toggle-text-color="black"
                            no-caps
                            :options="cvss40Items.E || []"
                            :readonly="readonly"
                        />
                    </div>
                </q-card-section>

                <q-separator />
                
                <!-- Environmental Section -->
                <q-card-section class="row">
                    <div class="col-md-3" style="align-self:center">
                        <span class="text-h6">Métriques Environnementales</span>
                    </div>
                    <q-space />
                    <div class="scoreRating" :class="cvss40.environmentalSeverity">
                        <span class="baseSeverity" v-if="!cvss40.environmentalMetricScore">Score environnemental</span>
                        <div v-else>
                            <span class="baseMetricScore">{{cvss40.environmentalMetricScore}}</span>
                            <span class="baseSeverity">({{cvss40.environmentalSeverity}})</span>
                        </div>
                    </div>
                </q-card-section>
                <q-separator />
                
                <q-card-section class="row q-col-gutter-md">
                    <div class="col-md-6">
                        <!-- Requirements -->
                        <div class="q-my-sm text-weight-bold">
                            <span>Exigence de Confidentialité (CR)</span>
                        </div>
                        <q-btn-toggle
                            class="group-btn"
                            v-model="cvss40Obj.CR"
                            toggle-color="grey-5"
                            toggle-text-color="black"
                            no-caps
                            :options="cvss40Items.CR || []"
                            :readonly="readonly"
                        />

                        <div class="q-my-sm text-weight-bold">
                            <span>Exigence d'Intégrité (IR)</span>
                        </div>
                        <q-btn-toggle
                            class="group-btn"
                            v-model="cvss40Obj.IR"
                            toggle-color="grey-5"
                            toggle-text-color="black"
                            no-caps
                            :options="cvss40Items.IR || []"
                            :readonly="readonly"
                        />

                        <div class="q-my-sm text-weight-bold">
                            <span>Exigence de Disponibilité (AR)</span>
                        </div>
                        <q-btn-toggle
                            class="group-btn"
                            v-model="cvss40Obj.AR"
                            toggle-color="grey-5"
                            toggle-text-color="black"
                            no-caps
                            :options="cvss40Items.AR || []"
                            :readonly="readonly"
                        />
                    </div>
                    
                    <div class="col-md-6">
                        <!-- Modified Base Metrics (simplified for now) -->
                        <div class="text-subtitle2 text-grey-7">
                            Métriques de base modifiées disponibles mais non affichées pour simplifier l'interface.
                            Utilisez "X" (Non défini) par défaut.
                        </div>
                    </div>
                </q-card-section>
            </q-expansion-item>
        </q-card>
    </div>
</template>

<script>
import { defineComponent } from 'vue';
import CvssCalculator from './cvsscalculator.vue';

export default defineComponent({
  emits: ['update:modelValue', 'update:cvssv4Value'],
  name: 'cvss-calculator-unified',
  components: {
    CvssCalculator
  },
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    cvssv4Value: {
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
      cvssVersion: '3.1', // Default to 3.1
      versionOptions: [
        { label: 'CVSS 3.1', value: '3.1' },
        { label: 'CVSS 4.0', value: '4.0' }
      ],
      
      // Internal state for both versions
      internalCvss3Vector: '',
      internalCvss4Vector: '',
      
      // CVSS 4.0 Items
      cvss40Items: {
        AV: [
          { label: 'Network', value: 'N' },
          { label: 'Adjacent', value: 'A' },
          { label: 'Local', value: 'L' },
          { label: 'Physical', value: 'P' }
        ],
        AC: [
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        AT: [  // New in 4.0
          { label: 'None', value: 'N' },
          { label: 'Present', value: 'P' }
        ],
        PR: [
          { label: 'None', value: 'N' },
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        UI: [  // Modified in 4.0
          { label: 'None', value: 'N' },
          { label: 'Passive', value: 'P' },
          { label: 'Active', value: 'A' }
        ],
        
        // Vulnerable System Impact
        VC: [
          { label: 'None', value: 'N' },
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        VI: [
          { label: 'None', value: 'N' },
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        VA: [
          { label: 'None', value: 'N' },
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        
        // Subsequent Systems Impact (New in 4.0)
        SC: [
          { label: 'None', value: 'N' },
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        SI: [
          { label: 'None', value: 'N' },
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        SA: [
          { label: 'None', value: 'N' },
          { label: 'Low', value: 'L' },
          { label: 'High', value: 'H' }
        ],
        
        // Threat Metrics
        E: [
          { label: 'Not Defined', value: 'X' },
          { label: 'Attacked', value: 'A' },
          { label: 'Unreported', value: 'U' },
          { label: 'Proof-of-Concept', value: 'P' },
          { label: 'Functional', value: 'F' },
          { label: 'High', value: 'H' }
        ],
        
        // Environmental Requirements
        CR: [
          { label: 'Not Defined', value: 'X' },
          { label: 'Low', value: 'L' },
          { label: 'Medium', value: 'M' },
          { label: 'High', value: 'H' }
        ],
        IR: [
          { label: 'Not Defined', value: 'X' },
          { label: 'Low', value: 'L' },
          { label: 'Medium', value: 'M' },
          { label: 'High', value: 'H' }
        ],
        AR: [
          { label: 'Not Defined', value: 'X' },
          { label: 'Low', value: 'L' },
          { label: 'Medium', value: 'M' },
          { label: 'High', value: 'H' }
        ]
      },

      // CVSS 4.0 Object
      cvss40Obj: {
        version: '4.0',
        AV: 'N', AC: 'L', AT: 'N', PR: 'N', UI: 'N',
        VC: 'N', VI: 'N', VA: 'N', SC: 'N', SI: 'N', SA: 'N',
        E: '',
        CR: '', IR: '', AR: ''
      },
      
      cvss40: {
        baseMetricScore: '',
        baseSeverity: '',
        threatMetricScore: '',
        threatSeverity: '',
        environmentalMetricScore: '',
        environmentalSeverity: '',
        exploitability: '',
        vulnerableSystemImpact: '',
        subsequentSystemImpact: ''
      },
      
      tooltip: {
        anchor: 'bottom middle',
        self: 'top left',
        delay: 500,
        maxWidth: '700px',
        class: '',
        style: 'font-size: 12px'
      },
      
      // Flag to prevent infinite loops during version switching
      isChangingVersion: false
    };
  },

  created() {
    // Initialize internal state from props
    this.internalCvss3Vector = this.modelValue || '';
    this.internalCvss4Vector = this.cvssv4Value || '';
    
    this.initializeFromModelValue();
    
    // If we have CVSS 4.0 data but no CVSS 3.1 data, start with CVSS 4.0
    if (!this.internalCvss3Vector && this.internalCvss4Vector && this.internalCvss4Vector.startsWith('CVSS:4.0')) {
      this.cvssVersion = '4.0';
      this.cvss40StrToObject(this.internalCvss4Vector);
      this.cvss40 = CVSS40.calculateCVSSFromVector(this.internalCvss4Vector);
    }
  },

  watch: {
    modelValue(val) {
      // Update internal state
      this.internalCvss3Vector = val || '';
      
      // Don't reinitialize during version switching
      if (this.isChangingVersion) return;
      
      // Only reinitialize if the version in the vector doesn't match current version
      if (val) {
        const vectorVersion = val.startsWith('CVSS:4.0') ? '4.0' : '3.1';
        if (vectorVersion !== this.cvssVersion) {
          this.initializeFromModelValue();
        }
      }
    },
    cvssv4Value(val) {
      // Update internal state
      this.internalCvss4Vector = val || '';
      
      // Don't reinitialize during version switching
      if (this.isChangingVersion) return;
      
      // If we have CVSS 4.0 data and we're currently on CVSS 4.0, update
      if (val && val.startsWith('CVSS:4.0') && this.cvssVersion === '4.0') {
        this.cvss40StrToObject(val);
        this.cvss40 = CVSS40.calculateCVSSFromVector(val);
      }
    },
    cvss40Obj: {
      handler() {
        if (this.cvssVersion === '4.0' && !this.isChangingVersion) {
          this.cvss40ObjectToStr();
        }
      },
      deep: true
    }
  },

  methods: {
    initializeFromModelValue() {
      // Determine which version to show based on available data
      if (this.cvssv4Value && this.cvssv4Value.startsWith('CVSS:4.0')) {
        // We have CVSS 4.0 data, start with CVSS 4.0
        this.cvssVersion = '4.0';
        this.cvss40Obj = {
          version: '4.0',
          AV: 'N', AC: 'L', AT: 'N', PR: 'N', UI: 'N',
          VC: 'N', VI: 'N', VA: 'N', SC: 'N', SI: 'N', SA: 'N',
          E: '',
          CR: '', IR: '', AR: ''
        };
        this.cvss40StrToObject(this.cvssv4Value);
        this.cvss40 = CVSS40.calculateCVSSFromVector(this.cvssv4Value);
      } else if (this.modelValue && this.modelValue.startsWith('CVSS:3.1')) {
        // We have CVSS 3.1 data, start with CVSS 3.1
        this.cvssVersion = '3.1';
      } else {
        // No specific data, default to CVSS 3.1
        this.cvssVersion = '3.1';
      }
    },

    onVersionChange(newVersion) {
      this.isChangingVersion = true;
      
      if (newVersion === '4.0') {
        // Use existing CVSS 4.0 data from props if available, otherwise default
        let cvss4Vector = this.cvssv4Value;
        
        if (!cvss4Vector || !cvss4Vector.startsWith('CVSS:4.0')) {
          // No existing CVSS 4.0 data, use default
          cvss4Vector = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:N/SC:N/SI:N/SA:N';
        }
        
        // Update internal state
        this.internalCvss4Vector = cvss4Vector;
        
        // Initialize CVSS 4.0 object
        this.cvss40Obj = {
          version: '4.0',
          AV: 'N', AC: 'L', AT: 'N', PR: 'N', UI: 'N',
          VC: 'N', VI: 'N', VA: 'N', SC: 'N', SI: 'N', SA: 'N',
          E: '',
          CR: '', IR: '', AR: ''
        };
        
        // Parse existing vector
        this.cvss40StrToObject(cvss4Vector);
        this.cvss40 = CVSS40.calculateCVSSFromVector(cvss4Vector);
        
        // CVSS 4.0: save only to cvssv4Value, don't touch modelValue (cvssv3)
        this.$emit('update:cvssv4Value', cvss4Vector);
      } else {
        // Switch back to CVSS 3.1 - use existing data from props
        let cvss3Vector = this.modelValue;
        
        if (!cvss3Vector || cvss3Vector.startsWith('CVSS:4.0')) {
          // No existing CVSS 3.1 data, use default
          cvss3Vector = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N';
        }
        
        // Update internal state
        this.internalCvss3Vector = cvss3Vector;
        
        // Emit CVSS 3.1 vector to modelValue (for display)
        this.$emit('update:modelValue', cvss3Vector);
      }
      
      // Reset flag after a short delay
      this.$nextTick(() => {
        this.isChangingVersion = false;
      });
    },

    roundUp1(n) {
      return CVSS40.roundUp1(n);
    },

    cvss40StrToObject(str) {
      if (str) {
        const temp = str.split('/');
        for (let i = 0; i < temp.length; i++) {
          const elt = temp[i].split(':');
          if (this.cvss40Obj.hasOwnProperty(elt[0])) {
            this.cvss40Obj[elt[0]] = elt[1] || '';
          }
        }
      }
    },

    cvss40ObjectToStr() {
      let vectorString = 'CVSS:' + this.cvss40Obj.version;
      
      // Base metrics are required - always include them
      const requiredMetrics = ['AV', 'AC', 'AT', 'PR', 'UI', 'VC', 'VI', 'VA', 'SC', 'SI', 'SA'];
      
      for (const key of requiredMetrics) {
        const value = this.cvss40Obj[key] || 'N'; // Default to 'N' if empty
        vectorString += `/${key}:${value}`;
      }
      
      // Optional metrics - only include if they have a value
      for (const key in this.cvss40Obj) {
        if (key !== 'version' && !requiredMetrics.includes(key) && this.cvss40Obj[key]) {
          vectorString += `/${key}:${this.cvss40Obj[key]}`;
        }
      }

      // Only calculate if we have a complete vector
      try {
        this.cvss40 = CVSS40.calculateCVSSFromVector(vectorString);
      } catch (error) {
        // Reset to default values if calculation fails
        this.cvss40 = {
          baseMetricScore: '',
          baseSeverity: '',
          threatMetricScore: '',
          threatSeverity: '',
          environmentalMetricScore: '',
          environmentalSeverity: '',
          exploitability: '',
          vulnerableSystemImpact: '',
          subsequentSystemImpact: ''
        };
      }
      
      // Update internal state
      this.internalCvss4Vector = vectorString;
      
      // CVSS 4.0: save only to cvssv4Value, don't touch modelValue (cvssv3)
      this.$emit('update:cvssv4Value', vectorString);
    },

    onCvss3Change(vectorString) {
      // Update internal state for CVSS 3.1
      this.internalCvss3Vector = vectorString;
      this.$emit('update:modelValue', vectorString);
    }
  }
});
</script>

<style>
/* Use existing styles from cvsscalculator.vue */
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
