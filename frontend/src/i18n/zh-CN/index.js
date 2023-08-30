export default {
    generalSettings: '通用设置',
    dangerSettings: '危险环境',
    changeDisplayLanguage: '界面显示语言',
    changeDisplayLanguageInfo: '为平台设置默认的显示语言',
    nav: {
        audits: '项目审计',
        vulnerabilities: '漏洞管理',
        data: '数据管理',
    },
    btn: {
        cancel: '取消',
        confirm: '确认',
        create: '创建',
        topButtonSection: {
            submitReview: '提交审核',
            cancelReview: '取消审核',
            approve: '批准',
            removeApproval: '移除批准',
        },
        backupFinding: "提议在漏洞库中创建/更新",
        delete: '删除',
        save: '保存',
        update: '更新',
        deleteAll: '全部删除',
        enable: '启用',
        valid: '有效的',
        new: '新的',
        updates: '有更新的',
        accountsEnabled: '账号启用',
        accountsDisabled: '账号禁用',
        accountEnabled: '账号启用',
        accountDisabled: '账号禁用'
    },
    tooltip: {
        usersConnected: '正在做审计的用户',
        editAudit: '编辑审计',
        downloadReport: '下载报告',
        deleteAudit: '删除审计',
        topButtonSection: {
            submitReview: '标记项目已准备好审核',
            cancelReview: '更改项目时需先取消审核',
            approve: '对该项目审核通过',
            removeApproval: '对该项目移除审核通过',
        },
        sortOptions: '排序选项',
        addToFindings: '添加到问题发现',
        edit: '编辑',
        view: '查看',
        findAudits: '查找审计项目',
        delete: '删除',
        download: '下载',
    },
    msg: {
        auditReviewUpdateOk: '项目审核状态更新成功',
        auditApprovalUpdateOk: '项目批准状态更新成功',
        auditUpdateOk: '项目更新成功',
        findingCreateOk: '问题创建成功',
        findingUpdateOk: '问题更新成功',
        findingDeleteOk: '问题删除成功',
        doYouWantToLeave: '你确定要离开吗？',
        thereAreUnsavedChanges: '有未保存的更改！',
        fieldRequired: '请填写所有必填字段',
        deleteFindingConfirm: '确认删除当前问题？',
        deleteFindingNotice: '此操作无法被取消',
        selectHost: '选择主机IP',
        importHostsFirst: '注意：请务必先导入扫描结果，下拉选中主机后IP再点击加号',
        auditTypeNotSet: '审计类型未设置',
        sectionUpdateOk: '段落更新成功',
        lastnameRequired: '“姓”未填写',
        firstnameRequired: '“名”未填写',
        emailRequired: '邮箱未填写',
        clientCreatedOk: '客户创建成功',
        clientUpdatedOk: '客户更新成功',
        clientDeletedOk: '客户删除成功',
        deleteNotice: '将被永久删除',
        confirmSuppression: '请您确认',
        usernameRequired: '用户名未填写',
        passwordRequired: '密码未填写',
        currentPasswordRequired: '当前密码未填写',
        confirmPasswordDifferents: '新密码与确认密码不相同',
        collaboratorCreatedOk: '审计员创建成功',
        collaboratorUpdatedOk: '审计员更新成功',
        collaboratorDeletedOk: '审计员删除成功',
        nameRequired: "名称未填写",
        fileRequired: '文件未上传',
        companyCreatedOk: '公司创建成功',
        companyUpdatedOk: '公司更新成功',
        companyDeletedOk: '公司删除成功',
        templateNotFound: '未找到模板',
        templateCreatedOk: '模板创建成功',
        templateUpdatedOk: '目标更新成功',
        allVulnerabilitesDeleteNotice: '所有漏洞将会被永久删除？',
        allVulnerabilitesDeleteOk: '所有漏洞删除成功',
        profileUpdateOk: '个人信息更新成功',
        settingsUpdatedOk: '系统设置更新成功',
        revertingSettings: '还原系统配置！',
        revertingSettingsConfirm: '您确认要还原系统配置吗？您将失去所有当前配置。',
        importingSettings: '导入系统配置！',
        importingSettingsConfirm: '您确认要导入系统配置吗？您将失去所有当前配置。',
        settingsImportedOk: '系统配置导入成功',
        vulnerabilityCreatedOk: '漏洞创建成功',
        vulnerabilityUpdatedOk: '漏洞更新成功',
        vulnerabilityDeletedOk: '漏洞删除成功',
        vulnerabilityWillBeDeleted: '漏洞将会被永久删除',
        confirmCategoryChange: '确认类别更改',
        categoryChangingNotice: '更改类别将会影响自定义字段显示',
        vulnerabilityMergeOk: '漏洞合并成功',
        tryingToContactBackend: '<p>尝试连接后端服务</p>',
        wrongContactingBackend: '连接后端服务失败',
    },
    err: {
        notDefinedLanguage: '没有定义这种语言',
        invalidYamlFormat: '检测到无效的 YAML 格式',
        parsingError1: '解析错误： {0}',
        parsingError2: '解析错误： line {0}， column: {1}',
        invalidJsonFormat: '检测到无效的 JSON 格式',
        jsonMustBeAnObject: 'JSON 必须为 object。',
        importingSettingsError: '导入系统配置错误',
        errorWhileParsingJsonContent: '解析JSON内容出错：{0}',
        titleRequired: '标题未填写',
        expiredToken: 'token过期',
        invalidToken: '无效token',
        invalidCredentials: '无效身份',
    },
    cvss: {
        title: 'CVSSv3 基础评分',
        impactSubscore: '影响子分数',
        exploitabilitySubscore: '可利用性子分数',
        infoWhenNoScore: '选择所有基本指标的值以生成分数',
        attackVector: '攻击向量',
        attackComplexity: '攻击复杂度',
        privilegesRequired: '权限需求',
        userInteraction: '用户交互',
        scope: '作用域',
        confidentialityImpact: '保密性影响',
        integrityImpact: '完整性影响',
        availabilityImpact: '可用性影响',
        network: '互联网',
        adjacentNetwork: '临近网络',
        local: '局域网',
        physical: '物理',
        low: '低',
        high: '高',
        required: '需要',
        none: '无',
        unchanged: '不变',
        changed: '改变',
        temporalEnvironmentalTitle: '时间和环境分数',
        temporalTitle: '时间分数',
        environmentalTitle: '环境分数',
        environmentalModifiedImpact: '修改后的影响子分数',
        environmentalModifiedExploitability: '修改后的可利用性子分数',
        exploitCodeMaturity: '漏洞利用代码成熟度',
        remediationLevel: '恢复级别',
        reportConfidence: '报告可信度',
        confidentialityRequirement: '保密性要求',
        integrityRequirement: '完整性要求',
        availabilityRequirement: '可用性要求',
        modifiedAttackVector: '修改后的攻击向量',
        modifiedAttackComplexity: '修改后的攻击复杂度',
        modifiedPrivilegesRequired: '修改后的权限需求',
        modifiedUserInteraction: '修改后的用户交互度',
        modifiedScope: '修改后的作用域',
        modifiedConfidentialityImpact: '修改后的保密性影响',
        modifiedIntegrityImpact: '修改后的完整性影响',
        modifiedAvailabilityImpact: '修改后的可用性影响',
        notDefined: '未定义',
        unproven: '未证实',
        poc: 'POC',
        functional: '功能性',
        officialFix: '官方修复',
        temporaryFix: '临时修复',
        workaround: '解决方案',
        unavailable: '不可用',
        unknown: '未知',
        reasonable: '合理',
        confirmed: '已确认',
        medium: '中等',
        tooltip: {
            baseMetricGroup_Legend: "“基本指标”组代表漏洞的内在特征，这些特征在不同时间和用户环境中是恒定的。 确定易受攻击的组件并对攻击向量、攻击复杂性、所需权限和与此相关的用户交互进行评分。",
            AV_Heading: "该指标反映了可能利用漏洞的环境。 为了利用易受攻击的组件，攻击者距离越远（逻辑上和物理上），基础分数就越增加越多。",
            AV_N_Label: "易受攻击的组件绑定到网络堆栈，并且可能的攻击者集合超出了列出的其他选项，甚至包括整个 Internet。 这种漏洞通常被称为“可远程利用”，并且可以被认为是一种可在协议级别利用一个或多个网络跃点（例如，跨一个或多个路由器）的攻击。",
            AV_A_Label: "易受攻击的组件绑定到网络堆栈，但攻击仅限于协议级别的相邻网络逻辑拓扑。 这可能意味着必须从相同的共享物理（例如，蓝牙或 无线）或逻辑（例如，本地 IP 子网）网络，或从安全或其他受限的管理域（例如，MPLS、安全 VPN 到一个管理网络区域）。",
            AV_L_Label: "易受攻击的组件未绑定到网络堆栈，攻击者的路径是通过读/写/执行功能。 要么：攻击者通过本地（例如，键盘、控制台）或远程（例如，SSH）访问目标系统来利用漏洞； 或者攻击者依靠其他人的用户交互来执行利用漏洞所需的操作（例如，诱骗合法用户打开恶意文档）。",
            AV_P_Label: "攻击需要攻击者物理接触或操纵易受攻击的组件。 物理交互可能是短暂的或持久的。",
            AC_Heading: "该指标描述了为了利用漏洞而必须存在的超出攻击者控制范围的条件。 这种情况可能需要收集有关目标或计算异常的更多信息。 该指标的评估不包括为利用漏洞而进行的任何用户交互要求。 如果攻击成功需要特定配置，则应假设易受攻击的组件在该配置中，对基本指标进行评分。",
            AC_L_Label: "不存在专门的准入条件或情有可原的情况。 攻击者可以期望针对易受攻击的组件取得可重复的成功。",
            AC_H_Label: "成功的攻击取决于攻击者无法控制的条件。 也就是说，成功的攻击不能随意完成，而是需要攻击者投入一些可衡量的努力来准备或执行针对易受攻击的组件，然后才能预期成功的攻击。 例如，成功的攻击可能需要攻击者： 收集有关易受攻击目标/组件所在环境的知识； 准备目标环境以提高漏洞利用的可靠性； 或者将自己注入到目标和受害者请求的资源之间的逻辑网络路径中，以读取和/或修改网络通信（例如，中间人攻击）。",
            PR_Heading: "该指标描述了攻击者在成功利用漏洞之前必须拥有的权限级别。",
            PR_N_Label: "攻击者在攻击之前是未经授权的，因此不需要对设置或文件进行任何访问即可进行攻击。",
            PR_L_Label: "攻击者被授权（即要求）提供基本用户功能的权限，这些权限通常只影响用户拥有的设置和文件。 或者，具有低权限的攻击者可能只对非敏感资源造成影响。",
            PR_H_Label: "攻击者被授权（即要求）特权，这些特权提供对可能影响组件范围设置和文件的易受攻击组件的重要（例如，管理）控制。",
            UI_Heading: "该指标衡量用户（而非攻击者）参与成功入侵易受攻击组件的要求。 该指标确定漏洞是否可以完全按照攻击者的意愿被利用，或者单独的用户（或用户启动的进程）是否必须以某种方式参与。",
            UI_N_Label: "易受攻击的系统可以在没有任何用户交互的情况下被利用。",
            UI_R_Label: "成功利用此漏洞需要用户采取一些措施才能利用此漏洞。",
            S_Heading: "成功的攻击是否会影响易受攻击组件以外的组件？ 如果是这样，则基础分数会增加，并且机密性、完整性和身份验证指标应相对于受影响的组件进行评分。",
            S_U_Label: "被利用的漏洞只能影响由同一安全机构管理的资源。 在这种情况下，易受攻击的组件和受影响的组件要么相同，要么都由相同的安全机构管理。",
            S_C_Label: "被利用的漏洞可能会影响超出易受攻击组件的安全权限管理的安全范围的资源。 在这种情况下，易受攻击的组件和受影响的组件是不同的，由不同的安全机构管理。",
            C_Heading: "该指标衡量由于成功利用漏洞而对软件组件管理的信息资源的机密性的影响。 机密性是指将信息访问和披露仅限于授权用户，以及防止未经授权的用户访问或披露。",
            C_N_Label: "受影响组件内的机密性不会丢失。",
            C_L_Label: "有一些保密性的损失。 获得了对某些受限信息的访问权，但攻击者无法控制获得的信息，或者损失的数量或种类受到限制。 信息披露不会对受影响的组成部分造成直接的、严重的损失。",
            C_H_Label: "机密性完全丧失，导致受影响组件中的所有资源都泄露给攻击者。 或者，仅获得了对一些受限信息的访问权，但所披露的信息会产生直接、严重的影响。",
            I_Heading: "该指标衡量成功利用的漏洞对完整性的影响。 完整性是指信息的可信度和真实性。",
            I_N_Label: "受影响的组件内没有完整性损失。",
            I_L_Label: "可以修改数据，但攻击者无法控制修改的结果，或者修改的数量有限。 数据修改不会对受影响的组件产生直接、严重的影响。",
            I_H_Label: "完全丧失完整性，或完全丧失保护。 例如，攻击者能够修改受受影响组件保护的任何/所有文件。 或者，只能修改部分文件，但恶意修改会对受影响的组件造成直接、严重的后果。",
            A_Heading: "该指标衡量成功利用漏洞对受影响组件可用性的影响。 它指的是受影响的组件本身失去可用性，例如网络服务（例如，Web、数据库、电子邮件）。 由于可用性是指信息资源的可访问性，因此消耗网络带宽、处理器周期或磁盘空间的攻击都会影响受影响组件的可用性。",
            A_N_Label: "受影响组件内的可用性没有影响。",
            A_L_Label: "性能降低或资源可用性中断。 即使可以重复利用该漏洞，攻击者也没有能力完全拒绝为合法用户提供服务。 受影响组件中的资源要么始终部分可用，要么仅在某些时间完全可用，但总体而言，受影响组件没有直接、严重的后果。",
            A_H_Label: "可用性完全丧失，导致攻击者能够完全拒绝访问受影响组件中的资源； 这种损失要么是持续的（攻击者继续进行攻击），要么是持久的（即使在攻击完成后情况仍然存在）。 或者，攻击者有能力拒绝某些可用性，但可用性的丧失会给受影响的组件带来直接、严重的后果（例如，攻击者不能中断现有连接，但可以阻止新连接；攻击者可以重复利用漏洞 即，在每次成功攻击的情况下，只会泄漏少量内存，但在反复利用后会导致服务完全不可用）。",
            temporalMetricGroup_Legend: "时间指标衡量漏洞利用技术或代码可用性的当前状态、是否存在任何补丁或变通办法，或者人们对漏洞描述的信心。",
            E_Heading: "该指标衡量漏洞被攻击的可能性，通常基于漏洞利用技术的当前状态、漏洞利用代码可用性或主动的“野外”利用。",
            E_X_Label: "分配此值表示没有足够的信息来选择其他值之一，并且对整体时间分数没有影响，即它对得分的影响与分配高相同。",
            E_U_Label: "没有可用的漏洞利用代码，或者漏洞利用是理论上的。",
            E_P_Label: "可以使用概念验证漏洞利用代码，或者攻击演示对于大多数系统来说是不切实际的。 代码或技术并非在所有情况下都有效，可能需要熟练的攻击者进行大量修改。",
            E_F_Label: "功能漏洞利用代码可用。 该代码适用于存在漏洞的大多数情况。",
            E_H_Label: "存在功能性自治代码，或者不需要利用（手动触发），并且可以广泛获得详细信息。 漏洞利用代码在任何情况下都有效，或者通过自主代理（例如蠕虫或病毒）主动传递。 联网系统可能会遇到扫描或利用尝试。 漏洞利用开发已经达到了可靠、广泛可用、易于使用的自动化工具的水平。",
            RL_Heading: "漏洞的修复级别是确定优先级的重要因素。 典型的漏洞在最初发布时未修补。 在发布正式补丁或升级之前，变通办法或修补程序可能会提供临时补救措施。 这些相应阶段中的每一个都将时间分数向下调整，反映了随着补救措施的最终紧迫性的降低。",
            RL_X_Label: "分配此值表示没有足够的信息来选择其他值之一，并且对整体 “时间分数” 没有影响，即它对评分的影响与分配 “不可用” 相同。",
            RL_O_Label: "提供完整的供应商解决方案。 供应商已经发布了官方补丁，或者可以进行升级。",
            RL_T_Label: "有一个官方但临时的修复程序可用。 这包括供应商发布临时修补程序、工具或解决方法的情况。",
            RL_W_Label: "有一个非官方的、非供应商的解决方案可用。 在某些情况下，受影响技术的用户将创建自己的补丁或提供解决或以其他方式缓解漏洞的步骤。",
            RL_U_Label: "要么没有可用的解决方案，要么无法应用。",
            RC_Heading: "该指标衡量对漏洞存在的信心程度和已知技术细节的可信度。 有时只公开漏洞的存在，而没有具体的细节。 例如，影响可能被认为是不可取的，但根本原因可能未知。 该漏洞稍后可能会被研究证实，该研究表明漏洞可能存在于何处，尽管研究可能不确定。 最后，漏洞可以通过受影响技术的作者或供应商的确认来确认。 当漏洞被确定存在时，漏洞的紧迫性会更高。 该指标还表明潜在攻击者可用的技术知识水平。",
            RC_X_Label: "分配此值表示没有足够的信息来选择其他值之一，并且对整体 “时间分数” 没有影响，即它对评分的影响与分配 “已确认” 相同。",
            RC_U_Label: "有影响报告表明存在漏洞。 报告表明漏洞的原因未知，或者报告可能对漏洞的原因或影响有所不同。 报告者不确定漏洞的真实性质，并且对于报告的有效性或是否可以应用静态基础分数（考虑到所描述的差异）几乎没有信心。 一个例子是一个错误报告，它指出发生了间歇性但不可重现的崩溃，内存损坏的证据表明可能会导致拒绝服务或更严重的影响。",
            RC_R_Label: "重要细节已公布，但研究人员要么对根本原因没有完全信心，要么无法访问源代码来完全确认可能导致结果的所有交互。 但是，存在合理的信心，即该错误是可重现的，并且至少可以验证一个影响（概念证明漏洞利用可能提供这一点）。 一个例子是对漏洞研究的详细记录，并附有解释（可能被混淆或“留给读者作为练习”），以保证如何重现结果。",
            RC_C_Label: "存在详细的报告，或者功能复制是可能的（功能漏洞可以提供这一点）。 源代码可用于独立验证研究的断言，或受影响代码的作者或供应商已确认存在漏洞。",
            environmentalMetricGroup_Legend: "这些指标使分析师能够根据受影响的 IT 资产对用户组织的重要性自定义 CVSS 分数，衡量标准是补充/替代安全控制、机密性、完整性和可用性。 度量是基本度量的修改等效项，并根据组织基础架构中的组件位置分配度量值。",
            CR_Heading: "这些指标使分析师能够根据受影响 IT 资产的机密性对用户组织的重要性（相对于其他影响）自定义 CVSS 分数。 该指标通过重新加权修改后的机密性影响指标与其他修改后的影响来修改环境分数。",
            CR_X_Label: "指定此值表示没有足够的信息来选择其他值之一，并且对整体环境评分没有影响，即它对评分的影响与指定中等相同。",
            CR_L_Label: "失去机密性可能只会对组织或与组织相关的个人（例如，员工、客户）产生有限的不利影响。",
            CR_M_Label: "将此值分配给指标不会影响分数。",
            CR_H_Label: "失去机密性可能会对组织或与组织相关的个人（例如员工、客户）产生灾难性的不利影响。",
            IR_Heading: "这些指标使分析师能够根据受影响 IT 资产的完整性相对于其他影响对用户组织的重要性来自定义 CVSS 分数。 该指标通过重新加权修改后的完整性影响指标与其他修改后的影响来修改环境分数。",
            IR_X_Label: "指定此值表示没有足够的信息来选择其他值之一，并且对整体环境评分没有影响，即它对评分的影响与指定中等相同。",
            IR_L_Label: "丧失诚信可能只会对组织或与组织相关的个人（例如员工、客户）产生有限的不利影响。",
            IR_M_Label: "将此值分配给指标不会影响分数。",
            IR_H_Label: "丧失诚信可能会对组织或与组织相关的个人（例如员工、客户）产生灾难性的不利影响。",
            AR_Heading: "这些指标使分析师能够根据受影响 IT 资产的可用性相对于其他影响对用户组织的重要性来自定义 CVSS 分数。 该指标通过重新加权修改后的可用性影响指标与其他修改后的影响来修改环境分数。",
            AR_X_Label: "指定此值表示没有足够的信息来选择其他值之一，并且对整体环境评分没有影响，即它对评分的影响与指定中等相同。",
            AR_L_Label: "可用性损失可能对组织或与组织相关的个人（例如，员工、客户）仅产生有限的不利影响。",
            AR_M_Label: "将此值分配给指标不会影响分数。",
            AR_H_Label: "可用性损失可能会对组织或与组织相关的个人（例如，员工、客户）产生灾难性的不利影响。",
            MAV_Heading: "该指标反映了可能利用漏洞的环境。 环境分数越高，攻击者可以越远程（逻辑上和物理上）以利用易受攻击的组件。",
            MAV_X_Label: "使用分配给相应基本指标的值。",
            MAV_N_Label: "易受攻击的组件绑定到网络堆栈，并且可能的攻击者集合超出了列出的其他选项，甚至包括整个 Internet。 这种漏洞通常被称为“可远程利用”，并且可以被认为是在一个或多个网络跳远的协议级别上可利用的攻击。",
            MAV_A_Label: "易受攻击的组件绑定到网络堆栈，但攻击仅限于协议级别的逻辑相邻拓扑。 这可能意味着必须从相同的共享物理（例如，蓝牙或 IEEE 802.11）或逻辑（例如，本地 IP 子网）网络，或从安全或其他受限的管理域（例如，MPLS、安全 VPN）内发起攻击 .",
            MAV_L_Label: "易受攻击的组件未绑定到网络堆栈，攻击者的路径是通过读/写/执行功能。 要么：攻击者通过本地（例如，键盘、控制台）或远程（例如，SSH）访问目标系统来利用漏洞； 或者攻击者依靠其他人的用户交互来执行利用漏洞所需的操作（例如，诱骗合法用户打开恶意文档）。",
            MAV_P_Label: "攻击需要攻击者物理接触或操纵易受攻击的组件。 物理交互可能是短暂的或持久的。",
            MAC_Heading: "该指标描述了为了利用漏洞而必须存在的超出攻击者控制范围的条件。 这种情况可能需要收集有关目标或计算异常的更多信息。 该指标的评估不包括为利用漏洞而进行的任何用户交互要求。 如果攻击成功需要特定配置，则应假设易受攻击的组件在该配置中，对基本指标进行评分。",
            MAC_X_Label: "使用分配给相应基本指标的值。",
            MAC_L_Label: "不存在专门的准入条件或情有可原的情况。 攻击者可以期望针对易受攻击的组件取得可重复的成功。",
            MAC_H_Label: "成功的攻击取决于攻击者无法控制的条件。 也就是说，成功的攻击不能随意完成，而是需要攻击者投入一些可衡量的努力来准备或执行针对易受攻击的组件，然后才能预期成功的攻击。 例如，成功的攻击可能需要攻击者： 收集有关易受攻击目标/组件所在环境的知识； 准备目标环境以提高漏洞利用的可靠性； 或者将自己注入到目标和受害者请求的资源之间的逻辑网络路径中，以读取和/或修改网络通信（例如，中间人攻击）。",
            MPR_Heading: "该指标描述了攻击者在成功利用漏洞之前必须拥有的权限级别。",
            MPR_X_Label: "使用分配给相应基本指标的值。",
            MPR_N_Label: "攻击者在攻击之前是未经授权的，因此不需要对设置或文件进行任何访问即可进行攻击。",
            MPR_L_Label: "攻击者被授权（即要求）提供基本用户功能的权限，这些权限通常只影响用户拥有的设置和文件。 或者，具有低权限的攻击者可能只对非敏感资源造成影响。",
            MPR_H_Label: "攻击者被授权（即要求）特权，这些特权提供对可能影响组件范围设置和文件的易受攻击组件的重要（例如，管理）控制。",
            MUI_Heading: "该指标涵盖用户（而非攻击者）参与成功入侵易受攻击组件的要求。 该指标确定漏洞是否可以完全按照攻击者的意愿被利用，或者单独的用户（或用户启动的进程）是否必须以某种方式参与。",
            MUI_X_Label: "使用分配给相应基本指标的值。",
            MUI_N_Label: "易受攻击的系统可以在没有任何用户交互的情况下被利用。",
            MUI_R_Label: "成功利用此漏洞需要用户采取一些措施才能利用此漏洞。",
            MS_Heading: "成功的攻击是否会影响易受攻击组件以外的组件？ 如果是这样，则基础分数会增加，并且机密性、完整性和身份验证指标应相对于受影响的组件进行评分。",
            MS_X_Label: "使用分配给相应基本指标的值。",
            MS_U_Label: "被利用的漏洞只能影响由同一安全机构管理的资源。 在这种情况下，易受攻击的组件和受影响的组件要么相同，要么都由相同的安全机构管理。",
            MS_C_Label: "被利用的漏洞可能会影响超出易受攻击组件的安全权限管理的安全范围的资源。 在这种情况下，易受攻击的组件和受影响的组件是不同的，由不同的安全机构管理。",
            MC_Heading: "该指标衡量由于成功利用漏洞而对软件组件管理的信息资源的机密性的影响。 机密性是指将信息访问和披露仅限于授权用户，以及防止未经授权的用户访问或披露。",
            MC_X_Label: "使用分配给相应基本指标的值。",
            MC_N_Label: "受影响组件内的机密性不会丢失。",
            MC_L_Label: "有一些保密性的损失。 获得了对某些受限信息的访问权，但攻击者无法控制获得的信息，或者损失的数量或种类受到限制。 信息披露不会对受影响的组成部分造成直接的、严重的损失。",
            MC_H_Label: "机密性完全丧失，导致受影响组件中的所有资源都泄露给攻击者。 或者，仅获得了对一些受限信息的访问权，但所披露的信息会产生直接、严重的影响。",
            MI_Heading: "该指标衡量成功利用的漏洞对完整性的影响。 诚信是指信息的可信度和真实性。",
            MI_X_Label: "使用分配给相应基本指标的值。",
            MI_N_Label: "受影响的组件内没有完整性损失。",
            MI_L_Label: "可以修改数据，但攻击者无法控制修改的结果，或者修改的数量有限。 数据修改不会对受影响的组件产生直接、严重的影响。",
            MI_H_Label: "完全丧失完整性，或完全丧失保护。 例如，攻击者能够修改被受影响组件保护的任何/所有文件。 或者，只能修改部分文件，但恶意修改会对受影响的组件造成直接、严重的后果。",
            MA_Heading: "该指标衡量成功利用漏洞对受影响组件可用性的影响。 它指的是受影响的组件本身失去可用性，例如网络服务（例如，Web、数据库、电子邮件）。 由于可用性是指信息资源的可访问性，因此消耗网络带宽、处理器周期或磁盘空间的攻击都会影响受影响组件的可用性。",
            MA_X_Label: "使用分配给相应基本指标的值。",
            MA_N_Label: "受影响组件内的可用性没有影响。",
            MA_L_Label: "性能降低或资源可用性中断。 即使可以重复利用该漏洞，攻击者也没有能力完全拒绝为合法用户提供服务。 受影响组件中的资源要么始终部分可用，要么仅在某些时间完全可用，但总体而言，受影响组件没有直接、严重的后果。",
            MA_H_Label: "可用性完全丧失，导致攻击者能够完全拒绝访问受影响组件中的资源； 这种损失要么是持续的（攻击者继续进行攻击），要么是持久的（即使在攻击完成后情况仍然存在）。 或者，攻击者有能力拒绝某些可用性，但可用性的丧失会给受影响的组件带来直接、严重的后果（例如，攻击者不能中断现有连接，但可以阻止新连接；攻击者可以重复利用漏洞 即，在每次成功攻击的情况下，只会泄漏少量内存，但在反复利用后会导致服务完全不可用）。"
        }
    },
    registerFirstUser: '注册第一个用户',
    customData: '自定义数据',
    custom: '自定义',
    settings: '系统设置',
    profile: '个人信息',
    logout: '退出登录',
    login: '登录',
    username: '用户名',
    password: '密码',
    noLanguage: '没有定义语言，请在如下位置定义语言',
    noAudit: '没有定义审计类型，请在如下位置定义审计类型',
    auditTypes: '审计类型',
    searchFinds: '搜索查找',
    myAudits: '我的审计',
    usersConnected: '已在线连接用户',
    awaitingMyReview: '等待我审核',
    newAudit: '新的审计',
    search: '搜索',
    users: '用户',
    auditNum1: '个审计项目',
    auditNums: '个审计项目',
    resultsPerPage: '每页结果数量：',
    createAudit: '创建审计',
    name: '名称',
    shortName: '简称',
    selectAssessment: '选择评估类型',
    selectLanguage: '选择语言',
    participants: '审计员',
    language: '语言',
    company: '公司',
    companies: '公司',
    date: '日期',
    sections: '段落',
    generalInformation: '基本信息',
    networkScan: '网络扫描',
    findings: '问题发现',
    automaticSorting: '自动排序',
    sortBy: '排序按',
    sortOrder: '排序顺序',
    ascending: '升序',
    descending: '降序',
    me: '我',
    cvssScore: 'CVSS分值',
    cvssTemporalScore: 'CVSS 时间分数',
    cvssEnvironmentalScore: 'CVSS 环境分数',
    priority: '优先级',
    remediation: '修复',
    remediationDifficulty: '修复难度',
    remediationComplexity: '修复复杂度',
    remediationPriority: '修复优先级',
    easy: '简单',
    medium: '中等',
    complex: '复杂',
    low: '低',
    high: '高',
    urgent: '紧急',
    title: '标题',
    category: '漏洞类别',
    selectCategory: '选择漏洞类别',
    noCategory: '无类别',
    vulnType: '漏洞类型',
    undefined: '未定义',
    vulnerabilityNum1: '个漏洞',
    vulnerabilitiesNums: '个漏洞',
    definition: '定义',
    proofs: '证明',
    details: '细节',
    completed: '已完成',
    type: '类型',
    description: '说明',
    observation: '观测',
    references: '参考资料（每条1行）',
    customFields: '自定义字段',
    affectedAssets: '受影响资产',
    courseOfActions: '行动方案',
    template: '模板',
    client: '客户',
    reviewers: '审核人员',
    collaborator: '审计员',
    collaborators: '审计员',
    startDate: '开始日期',
    endDate: '结束日期',
    reportingDate: '报告日期',
    auditScope: '范围（每个一行）',
    import: '导入',
    export: '导出',
    hostsAssociateScopes: '将导入的主机与范围关联',
    handleCustomData: '处理自定义数据',
    companies: '公司',
    clients: '客户',
    templates: '模板',
    addClient: '添加客户',
    editClient: '编辑客户',
    firstname: '名',
    lastname: '姓',
    email: '邮箱',
    function: '职能',
    phone: '座机',
    cell: '手机',
    role: '角色',
    collatorator: '审计员',
    addCollaborator: '添加审计员',
    editCollaborator: '编辑审计员',
    addCompany: '添加公司',
    editCompany: '编辑公司',
    logo: '图标',
    quantifier: '个',
    languages: '语言',
    extension: '扩展名',
    createTemplate: '创建模板',
    file: '文件',
    editTemplate: '编辑模板',
    importVulnerabilities: '导入漏洞',
    importVulnerabilitiesInfo: `从一个.yml或.json文件导入漏洞。（支持 Serpico 格式）<br />
    本操作可使您轻松导入一批漏洞模板。`,
    importVulnerabilitiesOk: '全部 <strong>{0}</strong> 个漏洞创建成功',
    importVulnerabilitiesAllExists: '全部 <strong>{0}</strong> 个漏洞标题已存在',
    importVulnerabilitiesPartial: '<strong>{0}</strong> 个漏洞创建成功<br /><strong>{1}</strong> 个漏洞标题已存在',
    exportVulnerabilities: '导出漏洞',
    exportVulnerabilitiesInfo: `将漏洞导出为 yaml 格式。之后可以轻松地重新导入此导出。`,
    deleteAllVulnerabilities: '删除所有漏洞',
    deleteAllVulnerabilitiesInfo: `删除库中所有漏洞。<br />
    <strong>本操作不可逆！！</strong>`,
    customSections: '自定义段落',
    listOfLanguages: '语言列表',
    editLanguages: '编辑语言',
    locale: '语言环境',
    auditTypesUsedInAudits: '审计中用到的审计类型',
    languageUsedInAuditsAndVuls: '在审计和漏洞中使用的语言',
    addSections: '添加段落',
    hideBuiltInSections: '隐藏内置段落',
    listOfAuditTypes: '审计类型列表',
    editAuditTypes: '编辑审计类型',
    createAtLeastOneLanguage: '请至少创建一种语言',
    createVulnerabilityTypes: '创建漏洞类型以便在漏洞管理和问题发现中使用',
    vulnerabilityTypesList: '漏洞类型列表',
    editVulnerabilityTypes: '编写漏洞类型',
    createVulnerabilityCategories: '创建漏洞类别以便在漏洞管理和漏洞发现中使用',
    defaultSortingOptions: '默认排序选项',
    listOfCategories: '漏洞类别列表',
    editCategories: '编辑漏洞类别',
    createAndManageCustomFields: '为不同视图创建和管理自定义表单',
    selectView: '选择视图',
    selectSection: '选择段落',
    selectComponent: '选择组件',
    label: '标签',
    size: '字体',
    offset: '偏移',
    required: '必填项',
    optionsLanguage: '选择语言',
    addOption: '添加选项',
    languageForDefaultText: '语言（用于默认文本）',
    createCustomSections: '创建自定义段落以便在审计中使用',
    fieldForTemplate: '字段（用于模板）',
    customIcon: '图标（Material/Font Awesome）',
    field: '字段',
    editSections: '编辑段落',
    vulnerabilityTypes: '漏洞类型',
    vulnerabilityCategories: '漏洞类别',
    auditGeneral: '审计编辑 -  常规',
    auditFinding: '审计编辑 -  问题发现',
    auditSection: '审计编辑 -  段落',
    vulnerability: '漏洞编辑',
    checkbox: '复选框',
    date: '日期',
    editor: '编辑器',
    input: '输入框',
    radio: '单选框',
    select: '下拉列表（单选）',
    selectMultiple: '下拉列表（多选）',
    space: '空格填充',
    updateUserInformation: '更新用户信息',
    newPassword: '新密码',
    confirmPassword: '确认密码',
    currentPassword: '当前密码 *',
    reports: '报告',
    reportsImagesBorder: '报告图片边框',
    extendCvssTemporalEnvironment:'扩展默认时间和环境 cvss 主题',
    addBorderToImages: '在生成的报告中，给图片添加边框。',
    currentColor: '当前颜色：',
    cvssColors: 'CVSS 颜色',
    changeCvssColorsDescription: '在生成的报告中，给不同CVSS严重性设置不同的颜色。',
    critical: '紧急',
    informational: '信息性',
    reviews: '审核',
    auditUpdateAfterApproval: '在审核通过后更新审计项目',
    changeApproveBehaviorIfAuditUpdated: '当审计项目更新后，修改审核通过状态时将执行：',
    removeAllPriorApprovals: '移除所有该项目之前的批准',
    keepAllPriorApprovals: '保留所有该项目之前的批准',
    mandatoryReview: '强制性审核',
    mandatoryReviewInfo: `使审查过程成为强制性的。 <br />激活后，用户无法导出审核，除非已获得指定数量的审核者批准。
    <br/>最少数量的审阅者还用于确定报告是否标记为已批准。`,
    minimalNumberOfReviewers: '审核者的最少数量',
    numberDayBeforeDelete:'删除前的天数',
    autoDeleteReport: '报告自动删除',
    saveSettings: '保存系统设置',
    revertSettingsToDefaults: '还原默认系统设置',
    importSettings: '导入系统设置',
    exportSettings: '导出系统设置',
    mergeVulnerabilities: '合并漏洞',
    mergeVulnerabilitiesInfo: `本操作的目标是将不同语言的不同漏洞合并到同一个漏洞中。<br /> 
    所以必须至少存在 2 种语言。`,
    newVulnerability: '新漏洞',
    total: '总共',
    addVulnerability: '添加漏洞',
    editVulnerability: '编辑漏洞',
    changeCategory: '修改类别',
    listOfSections: '段落列表',
    updateVulnerability: '更新漏洞',
    current: '当前的',
    languageAddFromRight: '语言（从右侧添加）',
    languageMoveToLeft: '语言（移动到左侧）',
    merge: '合并',
    goBack: '返回',
    // Remediation 
    changeRemediationColorsDescriptionComplexity: '更改报告中使用的颜色以表示修复的不同复杂性',
    changeRemediationColorsDescriptionPriority: '更改报告中使用的颜色以表示不同的补救优先级',
    remediationColorsPriority: '修复优先级颜色',
    remediationColorsComplexity: '修复复杂性颜色',
    // --- 
    twoStepVerification: '两步验证2-Step Verification',
    twoStepVerificationMessage: '打开您的身份验证应用程序并输入它提供的安全码。',
    captions: '标题',
    captionsDescription: '添加将在报告中使用的标题标签（默认为 \'Figure\'）'
  }
