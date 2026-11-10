// components/cvsscalculator.vue: CVSS 3.1 vector <-> metrics <-> scores (calculator of FIRST loaded from public/js)
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { QBtnToggle } from 'quasar'

import CvssCalculator from 'components/cvsscalculator'
import { FRONTEND_DIR } from '../../helpers/source'

// Global CVSS31 object, loaded by index.html in the application
beforeAll(() => {
  const code = fs.readFileSync(path.join(FRONTEND_DIR, 'public/js/cvsscalc31.js'), 'utf8')
  globalThis.CVSS31 = new Function(`${code}\nreturn CVSS31`)()
})

const BASE = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
let wrapper

function mountCalculator(modelValue, props = {}, extended = true) {
  wrapper = mount(CvssCalculator, {
    global: { mocks: { $settings: { report: { public: { extendCvssTemporalEnvironment: extended } } } } },
    props: {
      modelValue,
      ...props,
      // (also emitted while mounting, before the wrapper exists: the vector is rebuilt from the metrics)
      'onUpdate:modelValue': (value) => wrapper && wrapper.setProps({ modelValue: value })
    }
  })
  return wrapper
}

const emitted = () => (wrapper.emitted('update:modelValue') || []).map((args) => args[0])

afterEach(() => {
  wrapper && wrapper.unmount()
  wrapper = null
})

describe('cvss-calculator scores', () => {
  it.each([
    [BASE, '9.8', 'Critical'],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', '10.0', 'Critical'],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', '6.1', 'Medium'],
    ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', '7.8', 'High'],
    ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N', '3.7', 'Low'],
    ['CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:N/I:N/A:N', '0.0', 'None']
  ])('computes the base score of %s', (vector, score, severity) => {
    mountCalculator(vector)
    expect(String(wrapper.vm.cvss.baseMetricScore)).toBe(score)
    expect(wrapper.vm.cvss.baseSeverity).toBe(severity)
    expect(wrapper.find('.scoreRating').classes()).toContain(severity)
    expect(wrapper.find('.scoreRating').text()).toContain(`(${severity})`)
  })

  it('computes the temporal and environmental scores', () => {
    mountCalculator(`${BASE}/E:F/RL:O/RC:C/CR:H/IR:L/AR:L/MAV:L`)
    expect(wrapper.vm.cvss.baseMetricScore).toBe('9.8')
    expect(wrapper.vm.cvss.temporalMetricScore).toBe('9.1')
    expect(Number(wrapper.vm.cvss.environmentalMetricScore)).toBeLessThan(9.1)
  })

  it('shows the impact and exploitability subscores', () => {
    mountCalculator(BASE)
    expect(wrapper.text()).toContain('5.9') // impact
    expect(wrapper.text()).toContain('3.9') // exploitability
  })

  it('asks to select the metrics while the vector is incomplete', () => {
    mountCalculator('CVSS:3.1/AV:N/AC:L')
    expect(wrapper.vm.cvss.baseMetricScore).toBeFalsy()
    expect(wrapper.find('.scoreRating .baseSeverity').exists()).toBe(true)
    expect(wrapper.find('.baseMetricScore').exists()).toBe(false)
  })
})

describe('cvss-calculator vector', () => {
  it('reads the metrics of the vector', () => {
    mountCalculator(`${BASE}/E:P/MAV:A`)
    expect(wrapper.vm.cvssObj).toMatchObject({ version: '3.1', AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'H', E: 'P', RL: '', MAV: 'A' })
    expect(wrapper.findAllComponents(QBtnToggle)[0].props('modelValue')).toBe('N')
  })

  it('does not change a vector written in the order of the specification', async () => {
    mountCalculator(`${BASE}/E:F/RL:O/RC:C`)
    await flushPromises()
    expect(emitted().every((vector) => vector === `${BASE}/E:F/RL:O/RC:C`)).toBe(true)
  })

  it('does not emit anything for an empty vector', async () => {
    mountCalculator('')
    await flushPromises()
    expect(emitted()).toEqual([])
    expect(wrapper.vm.cvss.baseMetricScore).toBeFalsy()
  })

  it('builds the vector when a metric is selected', async () => {
    mountCalculator('')
    const toggles = wrapper.findAllComponents(QBtnToggle)
    toggles[0].vm.$emit('update:modelValue', 'A') // Attack vector: adjacent
    await flushPromises()
    expect(emitted().at(-1)).toBe('CVSS:3.1/AV:A')
    for (const [metric, value] of [['AC', 'H'], ['PR', 'L'], ['UI', 'R'], ['S', 'C'], ['C', 'L'], ['I', 'N'], ['A', 'H']])
      wrapper.vm.cvssObj[metric] = value
    await flushPromises()
    expect(emitted().at(-1)).toBe('CVSS:3.1/AV:A/AC:H/PR:L/UI:R/S:C/C:L/I:N/A:H')
    expect(wrapper.vm.cvss.baseMetricScore).toBe('6.2')
  })

  it('writes the metrics in the order of the specification whatever the selection order', async () => {
    mountCalculator('')
    wrapper.vm.cvssObj.MA = 'L'
    wrapper.vm.cvssObj.E = 'U'
    wrapper.vm.cvssObj.AV = 'N'
    await flushPromises()
    expect(emitted().at(-1)).toBe('CVSS:3.1/AV:N/E:U/MA:L')
  })

  it('updates the metrics when the vector is changed by the parent', async () => {
    mountCalculator(BASE)
    await wrapper.setProps({ modelValue: 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:C/C:N/I:L/A:N' })
    expect(wrapper.vm.cvssObj).toMatchObject({ AV: 'L', AC: 'H', PR: 'H', UI: 'R', S: 'C', C: 'N', I: 'L', A: 'N' })
    expect(wrapper.vm.cvss.baseMetricScore).toBe('2.3')
  })

  it('forgets the metrics absent from a new vector given by the parent', async () => {
    mountCalculator(`${BASE}/E:F/RL:O`)
    await wrapper.setProps({ modelValue: 'CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H' })
    await flushPromises()
    expect(wrapper.props('modelValue')).toBe('CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H')
    expect(wrapper.vm.cvssObj.E).toBe('')
    expect(wrapper.vm.cvssObj.RL).toBe('')
  })

  it('resets the metrics for an empty vector given by the parent, without emitting an empty CVSS vector', async () => {
    mountCalculator(`${BASE}/E:F`)
    const count = emitted().length
    await wrapper.setProps({ modelValue: '' })
    await flushPromises()
    expect(Object.entries(wrapper.vm.cvssObj).filter(([metric, value]) => metric !== 'version' && value)).toEqual([])
    expect(emitted().length).toBe(count)
    expect(wrapper.props('modelValue')).toBe('')
  })

  it('opens the temporal and environmental metrics according to the settings', () => {
    mountCalculator(BASE, {}, true)
    expect(wrapper.find('.q-expansion-item').classes()).toContain('q-expansion-item--expanded')
    wrapper.unmount()
    mountCalculator(BASE, {}, false)
    expect(wrapper.find('.q-expansion-item').classes()).toContain('q-expansion-item--collapsed')
  })

  it('ignores unknown metrics', () => {
    mountCalculator(`${BASE}/XX:Y/garbage`)
    expect(wrapper.vm.cvssObj).not.toHaveProperty('XX')
    expect(wrapper.vm.cvssObj.AV).toBe('N')
  })

  it('makes all the metric toggles read only when asked', () => {
    mountCalculator(BASE, { readonly: true })
    const toggles = wrapper.findAllComponents(QBtnToggle)
    expect(toggles.length).toBeGreaterThanOrEqual(8)
    expect(toggles.every((toggle) => toggle.props('readonly'))).toBe(true)
  })

  it('offers the values of the specification for each metric', () => {
    mountCalculator('')
    const values = Object.fromEntries(Object.entries(wrapper.vm.cvssItems).map(([metric, options]) => [metric, options.map((o) => o.value).join('')]))
    expect(values).toMatchObject({ AV: 'NALP', AC: 'LH', PR: 'NLH', UI: 'NR', S: 'UC', C: 'NLH', I: 'NLH', A: 'NLH', E: 'XUPFH', RL: 'XOTWU', RC: 'XURC', CR: 'XLMH', MAV: 'XNALP', MS: 'XUC' })
    // Every vector built with these values is valid for the calculator of FIRST
    const base = { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'H' }
    for (const [metric, options] of Object.entries(wrapper.vm.cvssItems)) {
      for (const option of options) {
        const metrics = { ...base, [metric]: option.value }
        const vector = 'CVSS:3.1/' + Object.entries(metrics).map(([key, value]) => `${key}:${value}`).join('/')
        expect(CVSS31.vectorStringRegex_31.test(vector), vector).toBe(true)
        expect(CVSS31.calculateCVSSFromVector(vector).success, vector).toBe(true)
      }
    }
  })
})
