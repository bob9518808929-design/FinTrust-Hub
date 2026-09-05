// FinTrust Hub Neo4j 图谱 Schema
// 技术栈: Neo4j 5 (企业-银行-担保-保险 多方关系 / 责任链节点 / 串通报价检测)

// ============================================================================
// 节点约束
// ============================================================================

CREATE CONSTRAINT enterprise_id IF NOT EXISTS
FOR (e:Enterprise) REQUIRE e.id IS UNIQUE;

CREATE CONSTRAINT bank_id IF NOT EXISTS
FOR (b:Bank) REQUIRE b.id IS UNIQUE;

CREATE CONSTRAINT guarantor_id IF NOT EXISTS
FOR (g:Guarantor) REQUIRE g.id IS UNIQUE;

CREATE CONSTRAINT insurer_id IF NOT EXISTS
FOR (i:Insurer) REQUIRE i.id IS UNIQUE;

CREATE CONSTRAINT worker_id IF NOT EXISTS
FOR (w:Worker) REQUIRE w.id IS UNIQUE;

CREATE CONSTRAINT tender_id IF NOT EXISTS
FOR (t:Tender) REQUIRE t.id IS UNIQUE;

CREATE CONSTRAINT responsibility_node_id IF NOT EXISTS
FOR (n:ResponsibilityNode) REQUIRE n.nodeId IS UNIQUE;

CREATE CONSTRAINT bank_group_unique IF NOT EXISTS
FOR (bg:BankGroup) REQUIRE bg.name IS UNIQUE;

// ============================================================================
// 节点标签
// ============================================================================

// :Enterprise { id, name, industry, riskProfile, creditScore, financingUnlocked }
// :Bank { id, name, bankGroup, baseRateValue }
// :BankGroup { name }
// :Guarantor { id, name, mode }
// :Insurer { id, name, mode }
// :Worker { id, name, role, deviceFp, enterpriseId }
// :Tender { id, enterpriseId, amount, rateFloor, status }
// :ResponsibilityNode { nodeId, name, role, operator, method, creditWeight, stage }
// :Credential { id, type, status }

// ============================================================================
// 关系类型
// ============================================================================

// (:Enterprise)-[:COOPERATES_WITH {mode}]->(:Bank)
// (:Enterprise)-[:GUARANTEED_BY {mode, activeGuarantees}]->(:Guarantor)
// (:Enterprise)-[:INSURED_BY {mode, activePolicies}]->(:Insurer)
// (:Bank)-[:BELONGS_TO]->(:BankGroup)
// (:Enterprise)-[:OWNS]->(:Worker)
// (:Enterprise)-[:PUBLISHED]->(:Tender)
// (:Bank)-[:BID_ON {rate, amount, status, isFraudulent}]->(:Tender)
// (:Enterprise)-[:HAS_CHAIN]->(:ResponsibilityNode)
// (:ResponsibilityNode)-[:NEXT_STAGE]->(:ResponsibilityNode)
// (:Enterprise)-[:HOLDS_CREDENTIAL {type, status}]->(:Credential)

// ============================================================================
// 串通报价检测 (ECO-05)
// 通过集团关联图谱 + 利率异常一致检测
// ============================================================================
// MATCH (b1:Bank)-[:BID_ON {rate: r1}]->(t:Tender)<-[:BID_ON {rate: r2}]-(b2:Bank)
// WHERE b1 <> b2 AND abs(r1 - r2) < 0.0001
// AND (b1)-[:BELONGS_TO]->(:BankGroup)<-[:BELONGS_TO]-(b2)
// RETURN b1, b2, t, r1, r2

// ============================================================================
// 责任链完整性分析
// ============================================================================
// MATCH (e:Enterprise)-[:HAS_CHAIN]->(n:ResponsibilityNode)
// WHERE e.id = $enterpriseId
// WITH e, collect(n) AS nodes
// RETURN e, nodes, size(nodes) AS chainLength,
//        sum(n.creditWeight) AS totalScore,
//        size(nodes) * 10 AS maxScore,
//        toFloat(sum(n.creditWeight)) / (size(nodes) * 10) AS completeness

// ============================================================================
// 多头防控 (ECO-05)
// 查询企业所有进行中的授信
// ============================================================================
// MATCH (e:Enterprise)-[:PUBLISHED]->(t:Tender)<-[:BID_ON {status: 'winner'}]-(b:Bank)
// WHERE e.id = $enterpriseId AND t.status IN ['awarded', 'bidding']
// RETURN sum(t.amount) AS totalExposure
