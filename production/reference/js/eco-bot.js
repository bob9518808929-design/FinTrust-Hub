/** 文件名：eco-bot.js 职责：ECO-09 数字分身 AI Agent 模拟器,仿微信聊天 UI 路由 5 类意图并支持语音 */
//
// 设计哲学（脑洞1）: 不再让企业员工去操作 APP。每个接入企业自动生成专属"数字员工"，
// 让系统去适应人的沟通习惯，老板在微信/钉钉里和机器人聊天即可完成查询与申请。
//
// 模拟器实现策略:
//   - 不真接微信/钉钉 API，模拟一个聊天 UI（仿微信对话气泡，左右分列）
//   - NLP 路由：关键词匹配 + 意图识别（置信度<0.8 反问确认）
//   - 预设 5 个意图: query_receivables_due / apply_financing / query_loan_pass_rate /
//                    query_reform_progress / sign_commitment
//   - 复用 PlainTextTranslator 思路：白话文 + 场景类比，绝不输出专业术语裸数据
//   - 敏感操作生成卡片 + 二次确认按钮（防误操作）
//   - 语音输入：Web Speech API（webkitSpeechRecognition），不可用降级为文字
//   - 对话历史用 localStorage.eco_bot_conversation_<entId> 持久化
//
// State 全局对象只读访问：window.State.enterprises / window.State.currentEnterpriseId
// 全部方法 async/await，禁止 callback 风格

(function () {
  'use strict';

  // ============================================================
  //  常量
  // ============================================================

  var CONFIDENCE_THRESHOLD = 0.8;       // spec: 置信度 < 0.8 反问确认
  var STORAGE_PREFIX = 'eco_bot_conversation_'; // localStorage key 前缀
  var BINDING_KEY = 'eco_bot_bound_enterprise'; // 当前绑定企业
  var MAX_HISTORY = 200;                // 单企业对话最多保留条数
  var VOICE_LANG = 'zh-CN';

  // ============================================================
  //  白话文翻译器（复用 PlainTextTranslator 思路）
  //  规则: 不输出专业术语裸数据，强制白话文 + 场景类比
  // ============================================================

  var PlainTalk = {
    // 信用分 → 白话 + 场景类比
    creditScore: function (score) {
      if (score >= 800) return '信用分 ' + score + ' 分，相当于班里前 5% 的尖子生，银行抢着要';
      if (score >= 720) return '信用分 ' + score + ' 分，相当于班里中上游的好学生，银行愿意贷款';
      if (score >= 650) return '信用分 ' + score + ' 分，相当于班里中等生，银行会观望，得看具体业务';
      if (score >= 600) return '信用分 ' + score + ' 分，相当于班里及格线徘徊，银行会反复犹豫';
      return '信用分 ' + score + ' 分，相当于班里后 10% 的差生，银行基本不敢贷款';
    },

    // 资产负债率 → 白话 + 场景类比（资产负债率 = (负债/资产)×100%）
    // 这里直接接受百分比数值
    debtRatio: function (ratioPct) {
      if (ratioPct >= 80) return '你欠的钱占总资产 ' + ratioPct.toFixed(0) + '%，相当于借了八成买房，银行看到会直接拒绝';
      if (ratioPct >= 70) return '你欠的钱占总资产 ' + ratioPct.toFixed(0) + '%，超过 70% 银行会害怕，相当于油表只剩一格';
      if (ratioPct >= 60) return '你欠的钱占总资产 ' + ratioPct.toFixed(0) + '%，相当于背了一半多房贷，银行会谨慎';
      if (ratioPct >= 40) return '你欠的钱占总资产 ' + ratioPct.toFixed(0) + '%，欠得不算多，银行觉得你够稳';
      return '你欠的钱占总资产 ' + ratioPct.toFixed(0) + '%，欠得很少，银行很放心';
    },

    // 水位 → 白话 + 场景类比
    waterLevel: function (level) {
      var pct = (level * 100).toFixed(0);
      if (level < 0.3) return '账户水位 ' + pct + '%，相当于油表亮红灯，再不补钱账户要被冻结';
      if (level < 0.5) return '账户水位 ' + pct + '%，相当于油表只剩两格，得赶紧准备补钱';
      if (level < 0.7) return '账户水位 ' + pct + '%，相当于油表过半，还能撑一段时间';
      return '账户水位 ' + pct + '%，相当于满箱油，资金很充足';
    },

    // 改造进度 → 白话 + 场景类比
    reformProgress: function (progress, completedTasks, totalTasks) {
      var pct = (progress * 100).toFixed(0);
      if (progress === 0) return '改造还没开始（0%），相当于没做作业就来考试，银行准入等级还卡在 D 级';
      if (progress < 0.5) return '改造做了 ' + pct + '%（' + completedTasks + '/' + totalTasks + ' 项任务），相当于装修水电走完还没刷墙，再坚持一下';
      if (progress < 1) return '改造做了 ' + pct + '%（' + completedTasks + '/' + totalTasks + ' 项任务），相当于装修最后刷漆阶段，快收尾了';
      return '改造已 100% 完成，相当于拿到了银行通行证，融资额度自动翻倍';
    },

    // 银行准入等级 → 白话
    grade: function (grade) {
      var map = {
        'D':  'D 级 — 银行大门关着，得先改造才能进',
        'C':  'C 级 — 银行开了侧门，但利息高、额度小',
        'B':  'B 级 — 银行正门开了，能正常贷款',
        'B+': 'B+ 级 — 银行 VIP 通道，利息有优惠',
        'A-': 'A- 级 — 银行重点客户，利率低、放款快',
        'A':  'A 级 — 银行抢着要你，议价权在你手上',
        'A+': 'A+ 级 — 银行VIP中的VIP，几乎零利息'
      };
      return map[grade] || (grade + ' 级');
    },

    // 金额 → 复用 State.formatAmount
    money: function (amount) {
      if (typeof State !== 'undefined' && typeof State.formatAmount === 'function') {
        return State.formatAmount(amount);
      }
      if (amount >= 100000000) return (amount / 100000000).toFixed(2) + '亿';
      if (amount >= 10000) return (amount / 10000).toFixed(0) + '万';
      return amount.toFixed(0) + '元';
    },

    // 利率 → 白话（高/中/低）
    rate: function (ent) {
      if (typeof State !== 'undefined' && typeof State.getRateString === 'function') {
        var raw = State.getRateString(ent);
        var discount = ent.runtime.rateDiscount;
        if (discount <= -0.5) return raw + '（行业最低档，相当于银行给你打了折）';
        if (discount === 0)  return raw + '（基准价，不增不减）';
        return raw + '（比基准高，相当于银行要收风险溢价）';
      }
      return 'LPR+1.5%';
    },

    // 信用完整度 → 白话（多少流开放）
    creditCompleteness: function (completeness, openFlows) {
      var pct = (completeness * 100).toFixed(0);
      if (completeness >= 0.8) return '信用完整度 ' + pct + '%（' + openFlows + '/6 流数据已开放），相当于简历写得很全，银行一眼看懂你';
      if (completeness >= 0.5) return '信用完整度 ' + pct + '%（' + openFlows + '/6 流数据已开放），相当于简历写了大半，银行看得明白但要补几项';
      return '信用完整度 ' + pct + '%（' + openFlows + '/6 流数据已开放），相当于简历只写了个名字，银行啥也看不清，必须先补数据';
    },

    // 通过率 → 白话
    passRate: function (rate, approved, total) {
      var pct = (rate * 100).toFixed(0);
      if (total === 0) return '暂时还没有贷款申请记录（相当于一张白纸，没法判断涨跌）';
      if (rate >= 0.8) return '贷款通过率 ' + pct + '%（' + approved + '/' + total + ' 笔通过），相当于十拿九稳';
      if (rate >= 0.5) return '贷款通过率 ' + pct + '%（' + approved + '/' + total + ' 笔通过），相当于一半对一半，得看具体业务';
      if (rate > 0)    return '贷款通过率 ' + pct + '%（' + approved + '/' + total + ' 笔通过），相当于十申九拒，得赶紧改造';
      return '贷款通过率 0%（0/' + total + ' 笔通过），相当于全部被拒，必须先做改造';
    }
  };

  // ============================================================
  //  敏感操作执行器
  //  复用 State 现有方法，模拟"提交融资申请 / 签署承诺书"
  // ============================================================

  var SensitiveActions = {
    // 提交融资申请 — 尝试调用 State.executeFinancing，失败则模拟
    apply_financing: async function (ent, entities) {
      var amount = entities.amount || 500000;
      var routeLevel = 'L3';
      var routeDesc = 'AI建议+人工审批';
      try {
        if (typeof State !== 'undefined' && typeof State.executeFinancing === 'function') {
          var result = State.executeFinancing(amount, routeLevel, routeDesc);
          return {
            ok: true,
            amount: amount,
            routeLevel: routeLevel,
            routeDesc: routeDesc,
            detail: result
          };
        }
      } catch (e) {
        // 降级为模拟
      }
      // 模拟执行：账户余额加一笔，水位上升
      if (ent && ent.financials) {
        ent.financials.accountBalance = (ent.financials.accountBalance || 0) + amount;
      }
      return { ok: true, amount: amount, routeLevel: routeLevel, routeDesc: routeDesc, detail: null, simulated: true };
    },

    // 签署承诺书 — 系统中暂无此 API，模拟签署并记录到企业 reform.completedActions
    sign_commitment: async function (ent) {
      var signedAt = new Date().toLocaleString('zh-CN', { hour12: false });
      var action = {
        id: 'COMMIT_' + Date.now(),
        type: 'commitment_signed',
        title: '数据真实性与资金用途合规承诺书',
        signedAt: signedAt,
        signer: ent ? (ent.name + ' 法人代表') : '企业代表',
        content: '承诺所提交财务数据真实有效，融资金额仅用于生产经营，不挪作他用'
      };
      try {
        if (ent && ent.reform) {
          if (!ent.reform.completedActions) ent.reform.completedActions = [];
          ent.reform.completedActions.push(action);
        }
        if (typeof State !== 'undefined' && typeof State.log === 'function') {
          State.log('enterprise', '🤖 数字员工: 企业签署《数据真实性与资金用途合规承诺书》', 'config');
        }
      } catch (e) { /* 忽略 */ }
      return { ok: true, signedAt: signedAt, action: action };
    }
  };

  // ============================================================
  //  意图库
  //  每个意图含: keywords (关键词) / examples (示例语句) / handler (处理函数)
  //  handler 返回 { reply: string, card?: cardPayload }
  // ============================================================

  var Intents = {
    // 意图 1: 查应收到期
    query_receivables_due: {
      name: '查应收到期',
      type: 'query',
      keywords: ['应收', '到期', '快到期', '回款', '账款', '收账款', '哪笔', '应收款', '账期', '欠我'],
      examples: [
        '帮我查下最近哪笔应收款快到期了',
        '有没有快到期的应收账款',
        '查一下应收到期情况',
        '我这月有什么应收款要回',
        '谁还欠我钱'
      ],
      handler: async function (ent, entities) {
        if (!ent || !ent.financials) {
          return { reply: '老板，我还没绑定企业身份，没法查应收款。请先在企业列表里选一家企业。' };
        }
        var arDetails = ent.financials.arDetails || [];
        var bills = ent.financials.billsHeld || [];
        var pendingAR = ent.financials.pendingAR || 0;

        // 整理到期清单（票据+应收款），按到期日排序
        var items = [];
        arDetails.forEach(function (ar) {
          items.push({
            id: ar.arId || 'AR?',
            type: '应收账款',
            counterparty: ar.buyer || '买方',
            amount: ar.amount || 0,
            dueDate: ar.dueDate || '未知',
            status: ar.confirmStatus || 'pending'
          });
        });
        bills.forEach(function (b) {
          items.push({
            id: b.billId,
            type: b.type === 'bank_acceptance' ? '银行承兑汇票' : '商业承兑汇票',
            counterparty: '票据',
            amount: b.amount,
            dueDate: b.dueDate,
            status: b.insured ? '已投保' : '未投保'
          });
        });

        // 按 dueDate 升序
        items.sort(function (a, b) {
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate < b.dueDate ? -1 : (a.dueDate > b.dueDate ? 1 : 0);
        });

        if (items.length === 0) {
          return {
            reply: '老板，我查了一下，你账上暂无应收账款或票据到期记录。\n' +
                   '不过待回款总额是 ' + PlainTalk.money(pendingAR) + '，相当于一笔钱还压在客户那里没到账。'
          };
        }

        // 距今天数（取系统当前日期）
        var today = new Date();
        var lines = items.map(function (it) {
          var days = '未知';
          if (it.dueDate && it.dueDate !== '未知') {
            var d = new Date(it.dueDate);
            var diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
            days = diff >= 0 ? (diff + ' 天后到期') : ('已逾期 ' + (-diff) + ' 天');
          }
          return '• ' + it.type + ' ' + it.id + ' | ' + PlainTalk.money(it.amount) + ' | ' +
                 it.dueDate + ' (' + days + ') | ' + it.counterparty + ' | ' + it.status;
        });

        var soonest = items[0];
        var soonestDays = '未知';
        if (soonest.dueDate && soonest.dueDate !== '未知') {
          var d0 = new Date(soonest.dueDate);
          var diff0 = Math.ceil((d0 - today) / (1000 * 60 * 60 * 24));
          soonestDays = diff0 >= 0 ? (diff0 + ' 天') : ('已逾期 ' + (-diff0) + ' 天');
        }

        var reply =
          '老板，我查了一下你的应收账款和票据到期情况：\n\n' +
          lines.join('\n') + '\n\n' +
          '最近一笔是 ' + soonest.type + ' ' + soonest.id + '，金额 ' + PlainTalk.money(soonest.amount) +
          '，' + soonestDays + '后到期。\n' +
          '打个比方：这就相当于你的客户给你开了张 ' + PlainTalk.money(soonest.amount) + ' 的欠条，' +
          (soonestDays.indexOf('逾期') >= 0 ? '已经超期了，得赶紧催收' : '还有 ' + soonestDays + ' 就该收钱') +
          '，建议提前 3 天联系对方财务确认打款。';

        return { reply: reply };
      }
    },

    // 意图 2: 申请融资
    apply_financing: {
      name: '申请融资',
      type: 'sensitive',  // 敏感操作 — 必须二次确认
      keywords: ['申请', '融资', '贷款', '借', '过桥', '资金', '申请一笔', '借款', '授信', '提款'],
      examples: [
        '申请一笔 50 万的过桥资金',
        '帮我申请 200 万贷款',
        '我想融资 500 万',
        '借点钱应急',
        '申请贷款'
      ],
      handler: async function (ent, entities) {
        if (!ent) {
          return { reply: '老板，我还没绑定企业身份，没法申请融资。请先选一家企业。' };
        }
        var amount = entities.amount || 500000;
        var maxAmount = (typeof State !== 'undefined' && typeof State.getMaxAmount === 'function')
          ? State.getMaxAmount(ent) : Math.floor((ent.financials.accountBalance || 0) * 3);

        // 资格预检
        var unlocked = ent.runtime && ent.runtime.financingUnlocked;
        var grade = ent.runtime && ent.runtime.creditGradeCap;
        var warnings = [];
        if (!unlocked) {
          warnings.push('当前企业融资功能未解锁（相当于门还没开），需先完成企业改造');
        }
        if (amount > maxAmount) {
          warnings.push('申请金额 ' + PlainTalk.money(amount) + ' 超过银行授信上限 ' + PlainTalk.money(maxAmount) + '，相当于你想借的钱超过银行愿意给的');
        }
        if (ent.runtime && ent.runtime.creditScore < 600) {
          warnings.push('信用分 ' + ent.runtime.creditScore + ' 偏低，银行审批可能不通过');
        }

        // Top3 银行方案（模拟撮合）
        var banks = [];
        if (typeof State !== 'undefined' && Array.isArray(State.banks) && State.banks.length > 0) {
          banks = State.banks.slice(0, 3).map(function (b, i) {
            var rate = (3.5 + i * 0.3 - (ent.runtime.rateDiscount || 0)).toFixed(2);
            return {
              rank: i + 1,
              bankName: b.bankName || b.name || ('银行 ' + (i + 1)),
              rate: rate + '%',
              maxAmount: Math.min(b.maxAmount || maxAmount, maxAmount),
              condition: b.condition || '需提供财报+合同'
            };
          });
        } else {
          banks = [
            { rank: 1, bankName: '工商银行', rate: '3.85%', maxAmount: maxAmount, condition: '需提供财报+合同' },
            { rank: 2, bankName: '建设银行', rate: '4.15%', maxAmount: Math.floor(maxAmount * 0.9), condition: '需提供财报+票据' },
            { rank: 3, bankName: '招商银行', rate: '4.45%', maxAmount: Math.floor(maxAmount * 0.8), condition: '需提供财报+担保' }
          ];
        }

        var reply =
          '老板，你想申请 ' + PlainTalk.money(amount) + ' 的融资，我帮你撮合了 Top3 银行方案：\n\n' +
          banks.map(function (b) {
            return '🥇 Top' + b.rank + ' ' + b.bankName + ' | 利率 ' + b.rate + ' | 额度上限 ' +
                   PlainTalk.money(b.maxAmount) + ' | ' + b.condition;
          }).join('\n') + '\n\n' +
          '打个比方：这就像找三家装修公司报价，利率越低越省钱。' +
          '推荐选 Top1，利率最低，相当于买同样的东西少花 ' +
          PlainTalk.money(Math.floor(amount * 0.005)) + '。\n';

        if (warnings.length > 0) {
          reply += '\n⚠️ 但有几个问题要先提醒你：\n' + warnings.map(function (w) { return '• ' + w; }).join('\n') + '\n';
        }

        // 生成敏感操作卡片
        var cardPayload = {
          id: 'card_fin_' + Date.now(),
          kind: 'apply_financing',
          title: '确认提交融资申请',
          summary: '提交金额 ' + PlainTalk.money(amount) + ' 的融资申请到 Top1 银行（' + banks[0].bankName + '）',
          fields: [
            { label: '申请金额', value: PlainTalk.money(amount) },
            { label: '目标银行', value: banks[0].bankName },
            { label: '预估利率', value: banks[0].rate },
            { label: '审批路由', value: 'L3 AI建议+人工审批' }
          ],
          warnings: warnings,
          confirmLabel: '✓ 确认提交',
          cancelLabel: '✗ 取消',
          confirmAction: { type: 'apply_financing', entId: ent.id, payload: { amount: amount } }
        };

        reply += '\n👉 这是敏感操作，请点下面卡片的「确认提交」按钮才会真正提交。';
        return { reply: reply, card: cardPayload };
      }
    },

    // 意图 3: 查贷款通过率
    query_loan_pass_rate: {
      name: '查贷款通过率',
      type: 'query',
      keywords: ['通过率', '通过', '批准', '审批', '拒', '申请结果', '涨了', '跌了', '过没过'],
      examples: [
        '我这个月贷款通过率涨了没',
        '查一下我的贷款通过率',
        '最近申请的贷款通过率怎么样',
        '我的贷款批准率高不高',
        '查通过率'
      ],
      handler: async function (ent) {
        if (!ent) {
          return { reply: '老板，我还没绑定企业身份，没法查通过率。请先选一家企业。' };
        }
        var queue = (typeof State !== 'undefined' && Array.isArray(State.approvalQueue)) ? State.approvalQueue : [];
        // 过滤当前企业的工单
        var mine = queue.filter(function (q) { return q.enterpriseId === ent.id || q.enterpriseName === ent.name; });
        var total = mine.length;
        var approved = mine.filter(function (q) { return q.status === 'approved'; }).length;
        var rejected = mine.filter(function (q) { return q.status === 'rejected'; }).length;
        var pending = mine.filter(function (q) { return q.status === 'pending'; }).length;
        var rate = total > 0 ? approved / total : 0;

        // 趋势：按时间排序前后两段对比
        var trend = '持平';
        if (total >= 2) {
          var half = Math.floor(total / 2);
          var firstHalf = mine.slice(0, half);
          var secondHalf = mine.slice(half);
          var r1 = firstHalf.length > 0 ? firstHalf.filter(function (q) { return q.status === 'approved'; }).length / firstHalf.length : 0;
          var r2 = secondHalf.length > 0 ? secondHalf.filter(function (q) { return q.status === 'approved'; }).length / secondHalf.length : 0;
          if (r2 > r1 + 0.1) trend = '上升';
          else if (r2 < r1 - 0.1) trend = '下降';
        }

        // 画像快照（信用分/等级/水位 — 复用 APP-02 画像能力）
        var creditScore = (ent.runtime && ent.runtime.creditScore) || 0;
        var grade = (ent.runtime && ent.runtime.creditGradeCap) || 'D';
        var waterLevel = (ent.runtime && ent.runtime.waterLevel) || 0;
        var openFlows = (typeof State !== 'undefined' && typeof State.countOpenFlows === 'function')
          ? State.countOpenFlows(ent) : 0;
        var completeness = (ent.runtime && ent.runtime.creditCompleteness) || 0;

        var reply =
          '老板，我查了一下你的贷款通过率情况：\n\n' +
          '• 总申请 ' + total + ' 笔 | 通过 ' + approved + ' 笔 | 拒绝 ' + rejected + ' 笔 | 待审批 ' + pending + ' 笔\n' +
          '• 当前通过率趋势：' + trend + '\n\n' +
          '顺手给你看下当前信用画像：\n' +
          '• ' + PlainTalk.creditScore(creditScore) + '\n' +
          '• 当前银行准入等级：' + PlainTalk.grade(grade) + '\n' +
          '• ' + PlainTalk.waterLevel(waterLevel) + '\n' +
          '• ' + PlainTalk.creditCompleteness(completeness, openFlows) + '\n\n' +
          PlainTalk.passRate(rate, approved, total) + '\n\n';

        if (rate < 0.5 && total > 0) {
          reply += '打个比方：这就相当于你投简历十份只回两份，问题出在简历上——也就是你的信用画像不够好。' +
                   '建议先去做企业改造（Tab0），把信用分提上来，通过率自然就涨了。';
        } else if (rate < 0.8 && total > 0) {
          reply += '打个比方：这就相当于你投简历十份回六份，简历还行但还能优化。' +
                   '建议补全五流数据（资金/合同/发票/物流/IoT），让银行看得更清楚。';
        } else if (total > 0) {
          reply += '打个比方：这就相当于你投简历十份回八份，简历很漂亮，继续保持。';
        } else {
          reply += '建议先发起一笔小额融资试试水，看看银行对你的评价如何。';
        }
        return { reply: reply };
      }
    },

    // 意图 4: 查改造进度
    query_reform_progress: {
      name: '查改造进度',
      type: 'query',
      keywords: ['改造', '进度', '做什么', '还要做', '待办', '做完', '改到哪', '怎么改', '改了'],
      examples: [
        '我的改造还要做啥',
        '查一下改造进度',
        '改造做到哪一步了',
        '改造进度怎么样',
        '我还要改什么'
      ],
      handler: async function (ent) {
        if (!ent) {
          return { reply: '老板，我还没绑定企业身份，没法查改造进度。请先选一家企业。' };
        }
        var re = (typeof State !== 'undefined' && State.reformEngine) ? State.reformEngine : null;
        var entReform = ent.reform || {};
        var progress = 0;
        var completedTasks = 0;
        var totalTasks = 0;
        var status = 'idle';
        var currentLevel = entReform.beforeLevel || 'D';
        var targetLevel = 'B';

        if (re) {
          // 优先用 reformEngine 的实时状态
          if (re.currentEnterpriseId === ent.id) {
            progress = re.progress || 0;
            completedTasks = re.completedTasks || 0;
            totalTasks = re.totalTasks || 0;
            status = re.status || 'idle';
            currentLevel = re.currentLevel || currentLevel;
            targetLevel = re.targetLevel || targetLevel;
          } else {
            // 改造引擎未挂到当前企业，用企业自身 reform 字段
            progress = entReform.hasReformed ? 1 : 0;
            completedTasks = (entReform.completedActions || []).length;
            totalTasks = Math.max(completedTasks, 8);
          }
        } else {
          progress = entReform.hasReformed ? 1 : 0;
          completedTasks = (entReform.completedActions || []).length;
          totalTasks = Math.max(completedTasks, 8);
        }

        // 待办任务清单
        var todoItems = [];
        if (re && re.taskDAG && re.currentEnterpriseId === ent.id) {
          re.taskDAG.forEach(function (t) {
            if (t.status !== 'completed') {
              todoItems.push({ id: t.id, name: t.name || t.title || '任务', priority: t.priority || '中' });
            }
          });
        }
        if (todoItems.length === 0 && progress < 1) {
          // 没有具体 DAG，给出建议性待办
          todoItems = [
            { id: 'R1', name: '完善 8 维信用画像', priority: '高' },
            { id: 'R2', name: '补全五流数据（合同/发票/物流/资金/IoT）', priority: '高' },
            { id: 'R3', name: '选择改造路径（保守/平衡/创新）', priority: '高' },
            { id: 'R4', name: '执行改造任务 DAG', priority: '中' }
          ];
        }

        var reply =
          '老板，我查了一下你的企业改造进度：\n\n' +
          '• 当前状态：' + (status === 'completed' ? '已完成' : status === 'idle' ? '未开始' : '进行中') + '\n' +
          '• 当前等级：' + PlainTalk.grade(currentLevel) + '\n' +
          '• 目标等级：' + PlainTalk.grade(targetLevel) + '\n' +
          '• ' + PlainTalk.reformProgress(progress, completedTasks, totalTasks) + '\n\n';

        if (todoItems.length > 0 && progress < 1) {
          reply += '还差这些事要做：\n' +
                   todoItems.map(function (t) { return '• [' + t.priority + '] ' + t.name; }).join('\n') + '\n\n' +
                   '👉 点击下面卡片可以一键跳到 Tab0 改造工作台继续。';
          return {
            reply: reply,
            card: {
              id: 'card_reform_' + Date.now(),
              kind: 'nav_reform',
              title: '跳转到企业改造工作台',
              summary: '去 Tab0 完成 ' + todoItems.length + ' 项待办任务',
              fields: [
                { label: '待办数', value: todoItems.length + ' 项' },
                { label: '目标等级', value: targetLevel + ' 级' }
              ],
              warnings: [],
              confirmLabel: '✓ 去改造',
              cancelLabel: '稍后',
              confirmAction: { type: 'nav_reform', entId: ent.id }
            }
          };
        }

        if (progress >= 1) {
          reply += '改造已经完成，相当于拿到了银行通行证。现在可以去 Tab2 申请融资，享受低利率和高额度。';
        }
        return { reply: reply };
      }
    },

    // 意图 5: 签署承诺书
    sign_commitment: {
      name: '签署承诺书',
      type: 'sensitive',  // 敏感操作 — 必须二次确认
      keywords: ['承诺', '承诺书', '签', '签署', '保证', '声明', '签字', '认领'],
      examples: [
        '我要签承诺书',
        '帮我签一下承诺书',
        '签署资金用途合规承诺书',
        '签数据真实性承诺',
        '认领承诺'
      ],
      handler: async function (ent) {
        if (!ent) {
          return { reply: '老板，我还没绑定企业身份，没法签承诺书。请先选一家企业。' };
        }
        var reply =
          '老板，签承诺书是法律行为，相当于你在法庭上宣誓「我保证数据是真的、钱不乱花」。' +
          '一旦签字，承诺书会进入区块链存证，不可撤销。\n\n' +
          '承诺内容包括：\n' +
          '• 所提交的财务数据真实有效\n' +
          '• 融资金额仅用于生产经营\n' +
          '• 不挪作他用、不进行关联交易\n' +
          '• 接受银行/监管的后续核查\n\n' +
          '👉 这是敏感操作，请点下面卡片的「确认签署」按钮才会真正生效。';

        return {
          reply: reply,
          card: {
            id: 'card_commit_' + Date.now(),
            kind: 'sign_commitment',
            title: '确认签署《数据真实性与资金用途合规承诺书》',
            summary: '签署后承诺书将进入区块链存证，不可撤销',
            fields: [
              { label: '签署企业', value: ent.name },
              { label: '签署人', value: '企业法人代表' },
              { label: '存证方式', value: '区块链存证（hash 上链）' },
              { label: '法律效力', value: '等同纸质签名' }
            ],
            warnings: ['签署后不可撤销，请确认你已阅读全部条款'],
            confirmLabel: '✓ 确认签署',
            cancelLabel: '✗ 取消',
            confirmAction: { type: 'sign_commitment', entId: ent.id }
          }
        };
      }
    },

    // 意图 6: 帮助 / 问候
    help: {
      name: '帮助',
      type: 'query',
      keywords: ['你好', '在吗', '帮', '你能', '你是谁', '什么', '帮帮我', 'hi', 'hello', '帮我'],
      examples: ['你好', '你能做什么', '帮我', '在吗'],
      handler: async function (ent) {
        var entName = ent ? ent.name : '（未绑定企业）';
        var reply =
          '老板你好，我是你的数字员工小融 🤖，绑定企业：' + entName + '\n\n' +
          '我能帮你做这些事（不用打开 APP，直接聊天就行）：\n' +
          '• 「查应收到期」— 查最近哪笔应收款/票据要到期\n' +
          '• 「申请融资 50 万」— 帮你撮合 Top3 银行方案并提交申请\n' +
          '• 「查通过率」— 看你贷款通过率涨了没\n' +
          '• 「改造进度」— 看企业改造还差啥没做\n' +
          '• 「签承诺书」— 帮你签数据真实性承诺\n\n' +
          '也可以点下面的快捷按钮，或者点 🎤 用语音提问。';
        return { reply: reply };
      }
    }
  };

  // ============================================================
  //  NLP 路由: 文本 → { intent, entities, confidence }
  //  实现: 关键词匹配 + 示例句相似度（Jaccard token overlap）
  //  置信度 < 0.8 时上层调用方应反问确认
  // ============================================================

  function tokenize(text) {
    if (!text) return [];
    // 中文按字符 + 英文按词
    var tokens = [];
    var lower = String(text).toLowerCase().trim();
    // 英文/数字 token
    var enMatches = lower.match(/[a-z0-9]+/g) || [];
    enMatches.forEach(function (t) { if (t.length > 1) tokens.push(t); });
    // 中文 bi-gram
    var cn = lower.replace(/[^\u4e00-\u9fa5]/g, '');
    for (var i = 0; i < cn.length - 1; i++) {
      tokens.push(cn.substr(i, 2));
    }
    // 单字（兜底，权重低）
    for (var j = 0; j < cn.length; j++) {
      tokens.push(cn.charAt(j));
    }
    return tokens;
  }

  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    var sa = {}, sb = {};
    a.forEach(function (t) { sa[t] = (sa[t] || 0) + 1; });
    b.forEach(function (t) { sb[t] = (sb[t] || 0) + 1; });
    var inter = 0, union = 0;
    Object.keys(sa).forEach(function (k) {
      if (sb[k]) inter += Math.min(sa[k], sb[k]);
      union += sa[k];
    });
    Object.keys(sb).forEach(function (k) {
      if (!sa[k]) union += sb[k];
    });
    return union === 0 ? 0 : inter / union;
  }

  // 从文本中抽取实体（金额、企业 ID 等）
  function extractEntities(text) {
    var entities = {};
    if (!text) return entities;
    // 金额: "50万" / "500万" / "1000元" / "1亿"
    var m = text.match(/(\d+(?:\.\d+)?)\s*(亿|万|千元|元)/);
    if (m) {
      var num = parseFloat(m[1]);
      var unit = m[2];
      var amount = num;
      if (unit === '亿') amount = num * 100000000;
      else if (unit === '万') amount = num * 10000;
      else if (unit === '千元') amount = num * 1000;
      entities.amount = amount;
      entities.amountRaw = m[0];
    }
    // 纯数字（无单位时按元处理）
    if (entities.amount === undefined) {
      var n = text.match(/(\d{4,})/);
      if (n) {
        entities.amount = parseInt(n[1], 10);
        entities.amountRaw = n[0];
      }
    }
    return entities;
  }

  // ============================================================
  //  EcoBot 核心对象
  // ============================================================

  var EcoBot = {
    intents: Intents,
    _boundEntId: null,
    _voiceRecognition: null,
    _voiceListening: false,
    _pendingCards: {},  // cardId -> cardPayload（待二次确认的卡片）

    // === 绑定企业身份（模拟微信企业微信+钉钉机器人接入企业） ===
    bindEnterprise: function (entId) {
      var ent = this._findEnterprise(entId);
      if (!ent) {
        console.warn('[EcoBot] bindEnterprise 失败: 找不到企业 ' + entId);
        return false;
      }
      this._boundEntId = entId;
      try {
        localStorage.setItem(BINDING_KEY, entId);
      } catch (e) { /* localStorage 不可用时降级为内存 */ }
      if (typeof State !== 'undefined' && typeof State.log === 'function') {
        State.log('enterprise', '🤖 数字员工已绑定企业: ' + ent.name + '（微信企业微信+钉钉机器人激活）', 'config');
      }
      return true;
    },

    // 获取当前绑定企业 ID（优先内存，其次 localStorage，最后 State.currentEnterpriseId）
    getBoundEnterpriseId: function () {
      if (this._boundEntId) return this._boundEntId;
      try {
        var saved = localStorage.getItem(BINDING_KEY);
        if (saved) { this._boundEntId = saved; return saved; }
      } catch (e) {}
      if (typeof State !== 'undefined' && State.currentEnterpriseId) {
        this._boundEntId = State.currentEnterpriseId;
        return this._boundEntId;
      }
      return null;
    },

    getBoundEnterprise: function () {
      var id = this.getBoundEnterpriseId();
      return id ? this._findEnterprise(id) : null;
    },

    _findEnterprise: function (entId) {
      if (typeof State === 'undefined' || !Array.isArray(State.enterprises)) return null;
      return State.enterprises.find(function (e) { return e.id === entId; }) || null;
    },

    // === NLP 路由: text → { intent, entities, confidence } ===
    nlpRoute: async function (text) {
      var input = String(text || '').trim();
      if (!input) {
        return { intent: null, entities: {}, confidence: 0 };
      }
      var entities = extractEntities(input);
      var inputTokens = tokenize(input);

      var bestIntent = null;
      var bestScore = 0;

      Object.keys(Intents).forEach(function (key) {
        var intent = Intents[key];
        var score = 0;

        // 1. 关键词命中（每个命中 +0.25，上限 0.6）
        var kwHits = 0;
        intent.keywords.forEach(function (kw) {
          if (input.indexOf(kw) >= 0) kwHits += 1;
        });
        score += Math.min(0.6, kwHits * 0.25);

        // 2. 示例句 Jaccard 相似度（取最高，权重 0.5）
        var maxSim = 0;
        intent.examples.forEach(function (ex) {
          var sim = jaccard(inputTokens, tokenize(ex));
          if (sim > maxSim) maxSim = sim;
        });
        score += maxSim * 0.5;

        if (score > bestScore) {
          bestScore = score;
          bestIntent = key;
        }
      });

      // 归一化到 0-1，封顶 0.98（避免声称 100% 确定）
      var confidence = Math.min(0.98, bestScore);
      // 阈值过低时降级为 help
      if (confidence < 0.2) {
        return { intent: 'help', entities: entities, confidence: 0.3, lowConfidence: true };
      }
      return {
        intent: bestIntent,
        entities: entities,
        confidence: parseFloat(confidence.toFixed(2))
      };
    },

    // === 生成白话文回复 + 场景类比（复用 PlainTalk） ===
    generateReply: async function (intentKey, entities) {
      var intent = Intents[intentKey];
      if (!intent) {
        return { reply: '抱歉，我没听懂你的意思。可以试试说「查应收到期」「申请融资 50 万」或者「改造进度」。' };
      }
      var ent = this.getBoundEnterprise();
      try {
        var result = await intent.handler(ent, entities || {});
        return result || { reply: '已处理。' };
      } catch (e) {
        console.error('[EcoBot] generateReply 异常:', e);
        return { reply: '老板，处理这条请求时出了点问题：' + (e.message || e) + '，请稍后再试。' };
      }
    },

    // === 发送敏感操作卡片（含二次确认按钮） ===
    // 这里只负责生成卡片并登记到 _pendingCards；UI 渲染由 EcoBotView 负责
    sendCard: async function (cardPayload) {
      if (!cardPayload || !cardPayload.id) {
        cardPayload = cardPayload || {};
        cardPayload.id = 'card_' + Date.now();
      }
      this._pendingCards[cardPayload.id] = cardPayload;
      return cardPayload;
    },

    // === 二次确认: 用户点确认按钮 → 执行敏感操作 ===
    confirmCard: async function (cardId) {
      var card = this._pendingCards[cardId];
      if (!card) return { ok: false, error: '卡片不存在或已失效' };
      var action = card.confirmAction || {};
      var ent = this._findEnterprise(action.entId) || this.getBoundEnterprise();
      var result;
      try {
        if (action.type === 'apply_financing') {
          result = await SensitiveActions.apply_financing(ent, action.payload || {});
        } else if (action.type === 'sign_commitment') {
          result = await SensitiveActions.sign_commitment(ent);
        } else if (action.type === 'nav_reform') {
          // 导航类: 切到 Tab0
          result = { ok: true, nav: 'reform', message: '已为你打开企业改造工作台' };
          try {
            var tabBtn = document.querySelector('.tab-btn[data-tab="reform"]');
            if (tabBtn) tabBtn.click();
          } catch (e) { /* 忽略 */ }
        } else {
          result = { ok: false, error: '未知操作类型: ' + action.type };
        }
      } catch (e) {
        result = { ok: false, error: e.message || String(e) };
      }
      // 卡片状态更新
      card.status = result.ok ? 'confirmed' : 'failed';
      card.result = result;
      delete this._pendingCards[cardId];
      return result;
    },

    // === 取消卡片 ===
    cancelCard: async function (cardId) {
      var card = this._pendingCards[cardId];
      if (card) {
        card.status = 'cancelled';
        delete this._pendingCards[cardId];
        return { ok: true, cancelled: true };
      }
      return { ok: false, error: '卡片不存在' };
    },

    // === 对话入口: 用户输入文本 → NLP路由 → 生成回复 → 返回完整消息 ===
    chat: async function (text) {
      var entId = this.getBoundEnterpriseId();
      var route = await this.nlpRoute(text);

      // 置信度 < 0.8 且不是 help 意图 → 反问确认
      if (route.confidence < CONFIDENCE_THRESHOLD && route.intent && route.intent !== 'help' && !route.lowConfidence) {
        var intentObj = Intents[route.intent];
        var confirmReply =
          '老板，我不太确定你想要的是「' + (intentObj ? intentObj.name : route.intent) + '」对吗？\n' +
          '如果是的话，请回复「确认」；如果你想要别的，可以直接说，比如：\n' +
          '• 查应收到期\n' +
          '• 申请融资 50 万\n' +
          '• 查通过率\n' +
          '• 改造进度\n' +
          '• 签承诺书\n\n' +
          '（置信度 ' + (route.confidence * 100).toFixed(0) + '%，低于 80% 阈值，所以反问一下）';
        return {
          route: route,
          reply: confirmReply,
          pendingConfirm: route.intent,
          needConfirm: true
        };
      }

      // 极低置信度（< 0.3）→ 直接 help
      if (route.lowConfidence) {
        var helpResult = await this.generateReply('help', route.entities);
        return { route: route, reply: helpResult.reply, card: helpResult.card };
      }

      // 正常生成回复
      var result = await this.generateReply(route.intent, route.entities);
      var response = { route: route, reply: result.reply };
      if (result.card) {
        await this.sendCard(result.card);
        response.card = result.card;
      }
      return response;
    },

    // === 对话历史持久化（localStorage.eco_bot_conversation_<entId>） ===
    getConversation: function (entId) {
      entId = entId || this.getBoundEnterpriseId();
      if (!entId) return [];
      try {
        var raw = localStorage.getItem(STORAGE_PREFIX + entId);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    },

    _saveConversation: function (entId, messages) {
      if (!entId) return;
      // 限制最大条数，FIFO 出队
      if (messages.length > MAX_HISTORY) {
        messages = messages.slice(messages.length - MAX_HISTORY);
      }
      try {
        localStorage.setItem(STORAGE_PREFIX + entId, JSON.stringify(messages));
      } catch (e) {
        // localStorage 满了或不可用，降级为只保留内存
        console.warn('[EcoBot] 对话历史持久化失败:', e);
      }
    },

    // 追加一条消息到对话历史
    appendMessage: function (entId, message) {
      entId = entId || this.getBoundEnterpriseId();
      if (!entId) return null;
      var messages = this.getConversation(entId);
      var msg = Object.assign({
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        ts: new Date().toLocaleTimeString('zh-CN', { hour12: false })
      }, message);
      messages.push(msg);
      this._saveConversation(entId, messages);
      return msg;
    },

    clearConversation: function (entId) {
      entId = entId || this.getBoundEnterpriseId();
      if (!entId) return false;
      try {
        localStorage.removeItem(STORAGE_PREFIX + entId);
      } catch (e) {}
      return true;
    },

    // === 语音输入: Web Speech API（webkitSpeechRecognition） ===
    isVoiceSupported: function () {
      return typeof window !== 'undefined' &&
        (typeof window.SpeechRecognition !== 'undefined' ||
         typeof window.webkitSpeechRecognition !== 'undefined');
    },

    startVoiceInput: async function () {
      var self = this;
      if (this._voiceListening) {
        return { ok: false, error: '正在录音中，请先停止' };
      }
      if (!this.isVoiceSupported()) {
        return { ok: false, error: '当前浏览器不支持语音输入（Web Speech API 不可用），已降级为文字输入' };
      }
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      var recognition = new SR();
      recognition.lang = VOICE_LANG;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      this._voiceRecognition = recognition;
      this._voiceListening = true;

      return new Promise(function (resolve) {
        var settled = false;
        function done(result) {
          if (settled) return;
          settled = true;
          self._voiceListening = false;
          self._voiceRecognition = null;
          resolve(result);
        }
        recognition.onresult = function (event) {
          var transcript = '';
          for (var i = 0; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          done({ ok: true, text: transcript });
        };
        recognition.onerror = function (event) {
          done({ ok: false, error: '语音识别失败: ' + (event.error || 'unknown') });
        };
        recognition.onend = function () {
          done({ ok: false, error: '录音结束（未识别到内容）' });
        };
        try {
          recognition.start();
        } catch (e) {
          done({ ok: false, error: '启动录音失败: ' + (e.message || e) });
        }
      });
    },

    stopVoiceInput: function () {
      if (this._voiceRecognition) {
        try { this._voiceRecognition.stop(); } catch (e) {}
        this._voiceRecognition = null;
        this._voiceListening = false;
      }
    },

    isListening: function () {
      return this._voiceListening;
    },

    // === 平台信息（模拟微信企业微信+钉钉机器人） ===
    getPlatformInfo: function () {
      var ent = this.getBoundEnterprise();
      return {
        bound: !!ent,
        enterpriseId: ent ? ent.id : null,
        enterpriseName: ent ? ent.name : null,
        channels: [
          { id: 'wecom', name: '企业微信机器人', icon: '💬', status: ent ? 'online' : 'offline' },
          { id: 'dingtalk', name: '钉钉机器人', icon: '📌', status: ent ? 'online' : 'offline' }
        ],
        voiceSupported: this.isVoiceSupported()
      };
    }
  };

  // ============================================================
  //  导出
  // ============================================================
  window.EcoBot = EcoBot;
  window.EcoBotPlainTalk = PlainTalk;  // 暴露给 UI 复用

})();
