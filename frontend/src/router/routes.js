import UserService from '@/services/user'

export default [
  {path: '/', component: () => import('layouts/home'), meta: {breadcrumb: 'Home'}, children: [
    {path: '', redirect: 'audits' },
    {path: 'audits', component: () => import('pages/audits'), meta: {breadcrumb: 'Audits'}, children: [
      {path: '', name:'audits', component: () => import('pages/audits/list')},
      // Audit edition: identifier of the audit only (/audits/<other text>: audits list filtered on a finding)
      {path: ':auditId([0-9a-fA-F]{24})', component: () => import('pages/audits/edit'), meta: {breadcrumb: 'Edit Audit'}, children: [
        {path: '', redirect: to => ({name: 'general', params: {auditId: to.params.auditId}})},
        {path: 'general', name:'general', component: () => import('pages/audits/edit/general')},
        {path: 'network', name: 'network', component: () => import('pages/audits/edit/network')},
        {path: 'findings/add', name: 'addFindings', component: () => import('pages/audits/edit/findings/add')},
        {path: 'findings/:findingId', name: 'editFinding', component: () => import('pages/audits/edit/findings/edit')},
        {path: 'sections/:sectionId', name: 'editSection', component: () => import('pages/audits/edit/sections')}
      ]},
      {path: ':finding', name:'audits_by_find', component: () => import('pages/audits/list')}
    ]},
    {path: 'data', component: () => import('pages/data'), meta: {breadcrumb: 'Datas'}, children: [
      {path: '', redirect: '/data/collaborators'},
      {path: 'collaborators', component: () => import('pages/data/collaborators')},
      {path: 'companies', component: () => import('pages/data/companies')},
      {path: 'clients', component: () => import('pages/data/clients')},
      {path: 'templates', component: () => import('pages/data/templates')},   
      {path: 'dump', component: () => import('pages/data/dump')},
      {path: 'custom', component: () => import('pages/data/custom')}
    ]},
    {path: 'vulnerabilities', component: () => import('@/pages/vulnerabilities'), meta: {breadcrumb: 'Vulnerabilities'}},
    {path: 'profile', component: () => import('pages/profile')},
    {path: 'settings', component: () => import('pages/settings')},
    // Optional reason of the error (params.error), shown by the page
    {path: '403/:error?', name: '403', component: () => import('pages/403')},
    {path: '404/:error?', name: '404', component: () => import('pages/404')}
  ]},
  {path: '/login', component: () => import('pages/login')},
  {path: '/:pathMatch(.*)*', redirect: '/'}
]
