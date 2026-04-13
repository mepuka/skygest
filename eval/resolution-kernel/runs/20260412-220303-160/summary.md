# Resolution Kernel Eval Run — 2026-04-13T03:03:04.071Z

Annotated: 20 | Pass: 0 | Fail: 20 | Unannotated bundles: 23
Wall-clock: 917ms

## Outcome-tag confusion matrix

| expected \ actual | Resolved | Ambiguous | Underspecified | Conflicted | OutOfRegistry | NoMatch |
| --- | --- | --- | --- | --- | --- | --- |
| Resolved | 2 | 6 | 1 | 0 | 7 | 4 |
| Ambiguous | 0 | 0 | 0 | 0 | 0 | 0 |
| Underspecified | 0 | 0 | 0 | 0 | 0 | 0 |
| Conflicted | 0 | 0 | 0 | 0 | 0 | 0 |
| OutOfRegistry | 0 | 0 | 0 | 0 | 0 | 0 |
| NoMatch | 0 | 0 | 0 | 0 | 0 | 0 |

## Failing rows

### 001-ember-energy (x://1207638939277955072/status/2042135430498304378)
- Expected: Resolved
- Actual: Ambiguous
- outcome-tag: expected Resolved, got Ambiguous
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFcfWeoWMAAJsvE.jpg agentId=https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1 interpret=Hypothesis outcome=Ambiguous
    sharedPartial: measuredProperty=generation, domainObject=electricity, statisticType=flow, technologyOrFuel=wind
    hypothesisItems=6 evidence=8
    item[0] GAP reason=required-facet-conflict missing=[]
    item[1] GAP reason=required-facet-conflict missing=[]
    item[2] GAP reason=required-facet-conflict missing=[]
    item[3] GAP reason=agent-scope-empty missing=[]
      candidate[0] var=var_01KNQEZ5WNBVQ06R676YPBZRE2 label="Wind electricity generation" matched=[measuredProperty, domainObject, technologyOrFuel, statisticType] mismatched=0
    item[4] GAP reason=required-facet-conflict missing=[]
    item[5] GAP reason=required-facet-conflict missing=[]
- Notes: seed 001-ember-energy: wind+solar generation record

### 002-1reluctantcog (x://1521502626323574785/status/1978187907778359345)
- Expected: Resolved
- Actual: OutOfRegistry
- outcome-tag: expected Resolved, got OutOfRegistry
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WNMWFT32DHZE32VG71] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/G3Pp1RbW0AAJQy_.jpg agentId=https://id.skygest.io/agent/ag_01KNQEZ5V57VJJJFYV6HWM03VB interpret=Hypothesis outcome=OutOfRegistry
    sharedPartial: measuredProperty=demand, domainObject=electricity, statisticType=price
    hypothesisItems=1 evidence=7
    item[0] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNXB2JR47T4ZEV0VQG label="Electricity demand" matched=[measuredProperty, domainObject] mismatched=1
      candidate[1] var=var_01KNQEZ5WNMWFT32DHZE32VG71 label="Wholesale electricity price" matched=[domainObject, statisticType] mismatched=1
      candidate[2] var=var_01KNQEZ5WN52GGSKRQ0PP5V8V4 label="Battery pack price" matched=[statisticType] mismatched=2
      … +2 more candidates
- Notes: seed 002-1reluctantcog: LBNL study

### 003-janrosenow (x://982294921/status/2042172070218330174)
- Expected: Resolved
- Actual: Ambiguous
- outcome-tag: expected Resolved, got Ambiguous
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WMZSP4FHM71ZK9YMF9] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFdArEWXMAAkAkK.jpg agentId=— interpret=Hypothesis outcome=Ambiguous
    sharedPartial: measuredProperty=deployment, statisticType=share, domainObject=heat pump, technologyOrFuel=heat pump
    hypothesisItems=4 evidence=8
    item[0] GAP reason=required-facet-conflict missing=[]
    item[1] GAP reason=required-facet-conflict missing=[]
    item[2] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WP0PD1A7H3TA56PTAG label="Heat pump installations" matched=[domainObject, technologyOrFuel] mismatched=3
      candidate[1] var=var_01KNQEZ5WN50KM85CVJQWYFMTY label="Clean electricity share" matched=[statisticType] mismatched=3
      candidate[2] var=var_01KNQEZ5WN17BV79YERCQWG27E label="Clean energy investment" matched=[] mismatched=4
      … +2 more candidates
    item[3] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WP0PD1A7H3TA56PTAG label="Heat pump installations" matched=[domainObject, technologyOrFuel] mismatched=2
      candidate[1] var=var_01KNQEZ5WN50KM85CVJQWYFMTY label="Clean electricity share" matched=[statisticType] mismatched=2
      candidate[2] var=var_01KNQEZ5WN17BV79YERCQWG27E label="Clean energy investment" matched=[] mismatched=3
      … +2 more candidates
- Notes: seed 003-janrosenow: heat pumps outsold gas boilers GB

### 004-lightbucket-bsky-social (at://did:plc:ii2yv4lw6nju7ynpwohqvvle/app.bsky.feed.post/3mhxfa7rf7k2n)
- Expected: Resolved
- Actual: OutOfRegistry
- outcome-tag: expected Resolved, got OutOfRegistry
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WNBVQ06R676YPBZRE2] unexpected=[]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:ii2yv4lw6nju7ynpwohqvvle/bafkreiatem5wk6dg2ord3jnpl7xexuh54gzy6lmclotac4s47yxc4vqgqy agentId=— interpret=Hypothesis outcome=OutOfRegistry
    sharedPartial: domainObject=electricity, technologyOrFuel=wind, measuredProperty=generation, statisticType=flow, unitFamily=power, aggregation=max
    hypothesisItems=1 evidence=6
    item[0] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNBVQ06R676YPBZRE2 label="Wind electricity generation" matched=[measuredProperty, domainObject, technologyOrFuel, statisticType] mismatched=2
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[measuredProperty, domainObject, statisticType] mismatched=2
      candidate[2] var=var_01KNQEZ5WN8PX3N5HTEAWMF1BV label="Coal electricity generation" matched=[measuredProperty, domainObject, statisticType] mismatched=3
      … +2 more candidates
- Notes: seed 004-lightbucket: GB wind power record

### 005-klstone-bsky-social (at://did:plc:eokofv4mj6egxuhucqseamtz/app.bsky.feed.post/3mivx5mpnic2j)
- Expected: Resolved
- Actual: Resolved
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH] unexpected=[https://id.skygest.io/variable/var_01KNQEZ5WNBVQ06R676YPBZRE2]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:eokofv4mj6egxuhucqseamtz/bafkreidgogr4gj7rgwz43v5rizdmmdhonxeccuzbxw2au32oqwravjfaba agentId=— interpret=Hypothesis outcome=Resolved
    sharedPartial: measuredProperty=generation, domainObject=electricity, technologyOrFuel=wind, statisticType=flow, unitFamily=energy
    hypothesisItems=1 evidence=4
    item[0] BOUND variable=https://id.skygest.io/variable/var_01KNQEZ5WNBVQ06R676YPBZRE2 label=Wind electricity generation
- Notes: seed 005-klstone: DE public net electricity generation

### 006-edcporter (x://1085245460825149443/status/2042159952765055188)
- Expected: Resolved
- Actual: NoMatch
- outcome-tag: expected Resolved, got NoMatch
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WNMWFT32DHZE32VG71] unexpected=[]
- agent-scope: expected https://id.skygest.io/agent/ag_01KNQEZ5VFHVJNF9VV9J3JQGV9, got —
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFc1dP2XMAA5Aco.jpg agentId=https://id.skygest.io/agent/ag_01KNQEZ5VFHVJNF9VV9J3JQGV9 interpret=Hypothesis outcome=NoMatch
    sharedPartial: measuredProperty=price, unitFamily=energy, domainObject=natural gas, technologyOrFuel=battery, aggregation=max
    hypothesisItems=6 evidence=14
    item[0] GAP reason=missing-required missing=[statisticType]
    item[1] GAP reason=missing-required missing=[statisticType]
    item[2] GAP reason=missing-required missing=[statisticType]
    item[3] GAP reason=missing-required missing=[statisticType]
    item[4] GAP reason=missing-required missing=[statisticType]
    item[5] GAP reason=missing-required missing=[statisticType]
- Notes: seed 006-edcporter: gas prices since Iran war

### 007-aukehoekstra (x://16933019/status/2042127910006354319)
- Expected: Resolved
- Actual: Ambiguous
- outcome-tag: expected Resolved, got Ambiguous
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN8PY5KZKS91E7QVTB] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFcYgxyWoAAVNvT.jpg agentId=— interpret=Hypothesis outcome=Ambiguous
    sharedPartial: domainObject=electricity, aggregation=max, technologyOrFuel=solar PV
    hypothesisItems=1 evidence=4
    item[0] GAP reason=required-facet-conflict missing=[]
- Notes: seed 007-aukehoekstra: solar power per kg

### 008-ben-inskeep (x://2687569825/status/2042291388335694128)
- Expected: Resolved
- Actual: NoMatch
- outcome-tag: expected Resolved, got NoMatch
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WNXB2JR47T4ZEV0VQG] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFeshxuXgAA33lR.png agentId=— interpret=Hypothesis outcome=NoMatch
    sharedPartial: domainObject=data center, measuredProperty=consumption, aggregation=max, unitFamily=dimensionless
    hypothesisItems=1 evidence=4
    item[0] GAP reason=missing-required missing=[statisticType]
- Notes: seed 008-ben-inskeep: Amazon data center sanitary sewer

### 009-irena (x://1926360631/status/2042231599429746849)
- Expected: Resolved
- Actual: OutOfRegistry
- outcome-tag: expected Resolved, got OutOfRegistry
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WNMWFT32DHZE32VG71] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFd2sMrb0AAC-8i.png agentId=https://id.skygest.io/agent/ag_01KNQEZ5VFCSDF9WTNRJ2JSMEN interpret=Hypothesis outcome=OutOfRegistry
    sharedPartial: measuredProperty=price, statisticType=price, aggregation=sum, unitFamily=currency, technologyOrFuel=solar PV
    hypothesisItems=4 evidence=12
    item[0] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNTF139XKP1XD29BF8 label="Offshore wind capital cost" matched=[measuredProperty, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN17BV79YERCQWG27E label="Clean energy investment" matched=[aggregation, unitFamily] mismatched=2
      candidate[2] var=var_01KNQEZ5WNZYEBK4ZT9J9PH733 label="Energy transition investment" matched=[aggregation, unitFamily] mismatched=2
      … +2 more candidates
    item[1] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNTF139XKP1XD29BF8 label="Offshore wind capital cost" matched=[measuredProperty, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN17BV79YERCQWG27E label="Clean energy investment" matched=[aggregation, unitFamily] mismatched=2
      candidate[2] var=var_01KNQEZ5WNZYEBK4ZT9J9PH733 label="Energy transition investment" matched=[aggregation, unitFamily] mismatched=2
      … +2 more candidates
    item[2] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNTF139XKP1XD29BF8 label="Offshore wind capital cost" matched=[measuredProperty, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN17BV79YERCQWG27E label="Clean energy investment" matched=[aggregation, unitFamily] mismatched=2
      candidate[2] var=var_01KNQEZ5WNZYEBK4ZT9J9PH733 label="Energy transition investment" matched=[aggregation, unitFamily] mismatched=2
      … +2 more candidates
    item[3] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNTF139XKP1XD29BF8 label="Offshore wind capital cost" matched=[measuredProperty, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN17BV79YERCQWG27E label="Clean energy investment" matched=[aggregation, unitFamily] mismatched=2
      candidate[2] var=var_01KNQEZ5WNZYEBK4ZT9J9PH733 label="Energy transition investment" matched=[aggregation, unitFamily] mismatched=2
      … +2 more candidates
- Notes: seed 009-irena: solar module cost projection

### 010-earthsciinfo-bsky-social (at://did:plc:yoeonndfygr7ilq5scih6rtx/app.bsky.feed.post/3miqz2vxlos27)
- Expected: Resolved
- Actual: Ambiguous
- outcome-tag: expected Resolved, got Ambiguous
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN7HAKBFJ3TZ09VA4H] unexpected=[]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:yoeonndfygr7ilq5scih6rtx/bafkreienrzpdeuowak6udeoikbcbz564eyygfrsaxz34efx3rhsdeot7yq agentId=— interpret=Hypothesis outcome=Ambiguous
    sharedPartial: measuredProperty=emissions, domainObject=natural gas, technologyOrFuel=natural gas
    hypothesisItems=2 evidence=6
    item[0] GAP reason=required-facet-conflict missing=[]
    item[1] GAP reason=missing-required missing=[statisticType]
- Notes: seed 010-earthsciinfo: emissions bar chart

### 012-hausfath-bsky-social (at://did:plc:r5ofoghdcbtjqiujqpvja4uh/app.bsky.feed.post/3mieyegruoz2h)
- Expected: Resolved
- Actual: NoMatch
- outcome-tag: expected Resolved, got NoMatch
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN7HAKBFJ3TZ09VA4H] unexpected=[]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:r5ofoghdcbtjqiujqpvja4uh/bafkreiat2n4q4chd26n4f7br4zb6u6twqddv2kgdnag5ydlgsxzolph3ia agentId=— interpret=Hypothesis outcome=NoMatch
    sharedPartial: measuredProperty=emissions, technologyOrFuel=methane, domainObject=grid, unitFamily=other
    hypothesisItems=1 evidence=8
    item[0] GAP reason=missing-required missing=[statisticType]
- Notes: seed 012-hausfath

### 013-weatherprof-bsky-social (at://did:plc:iczg6a2i3etk5bscga6uv6od/app.bsky.feed.post/3mhrm4736gs2y)
- Expected: Resolved
- Actual: OutOfRegistry
- outcome-tag: expected Resolved, got OutOfRegistry
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN7HAKBFJ3TZ09VA4H] unexpected=[]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:iczg6a2i3etk5bscga6uv6od/bafkreihtxg6tl4jfeqvma7zxs64u6hqqo4fatncedygoueubn6oxzjggim agentId=— interpret=Hypothesis outcome=OutOfRegistry
    sharedPartial: measuredProperty=price, statisticType=price, domainObject=heat
    hypothesisItems=3 evidence=3
    item[0] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WN52GGSKRQ0PP5V8V4 label="Battery pack price" matched=[measuredProperty, statisticType] mismatched=1
      candidate[1] var=var_01KNQEZ5WNTF139XKP1XD29BF8 label="Offshore wind capital cost" matched=[measuredProperty, statisticType] mismatched=1
      candidate[2] var=var_01KNQEZ5WNMWFT32DHZE32VG71 label="Wholesale electricity price" matched=[measuredProperty, statisticType] mismatched=1
      … +2 more candidates
    item[1] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WN52GGSKRQ0PP5V8V4 label="Battery pack price" matched=[measuredProperty, statisticType] mismatched=1
      candidate[1] var=var_01KNQEZ5WNTF139XKP1XD29BF8 label="Offshore wind capital cost" matched=[measuredProperty, statisticType] mismatched=1
      candidate[2] var=var_01KNQEZ5WNMWFT32DHZE32VG71 label="Wholesale electricity price" matched=[measuredProperty, statisticType] mismatched=1
      … +2 more candidates
    item[2] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WN52GGSKRQ0PP5V8V4 label="Battery pack price" matched=[measuredProperty, statisticType] mismatched=1
      candidate[1] var=var_01KNQEZ5WNTF139XKP1XD29BF8 label="Offshore wind capital cost" matched=[measuredProperty, statisticType] mismatched=1
      candidate[2] var=var_01KNQEZ5WNMWFT32DHZE32VG71 label="Wholesale electricity price" matched=[measuredProperty, statisticType] mismatched=1
      … +2 more candidates
- Notes: seed 013-weatherprof: earth energy imbalance

### 014-carbonbrief (x://223416400/status/2042214198491422952)
- Expected: Resolved
- Actual: OutOfRegistry
- outcome-tag: expected Resolved, got OutOfRegistry
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFdm_b5WkAAN13O.jpg agentId=— interpret=Hypothesis outcome=OutOfRegistry
    sharedPartial: measuredProperty=generation, statisticType=flow, unitFamily=energy, technologyOrFuel=wind, aggregation=max
    hypothesisItems=3 evidence=10
    item[0] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNBVQ06R676YPBZRE2 label="Wind electricity generation" matched=[measuredProperty, technologyOrFuel, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[measuredProperty, statisticType, unitFamily] mismatched=1
      candidate[2] var=var_01KNQEZ5WM9HP0NBCS5J38GJYT label="Battery discharge" matched=[measuredProperty, statisticType, unitFamily] mismatched=2
      … +2 more candidates
    item[1] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNBVQ06R676YPBZRE2 label="Wind electricity generation" matched=[measuredProperty, technologyOrFuel, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[measuredProperty, statisticType, unitFamily] mismatched=1
      candidate[2] var=var_01KNQEZ5WM9HP0NBCS5J38GJYT label="Battery discharge" matched=[measuredProperty, statisticType, unitFamily] mismatched=2
      … +2 more candidates
    item[2] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WNBVQ06R676YPBZRE2 label="Wind electricity generation" matched=[measuredProperty, technologyOrFuel, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[measuredProperty, statisticType, unitFamily] mismatched=1
      candidate[2] var=var_01KNQEZ5WM9HP0NBCS5J38GJYT label="Battery discharge" matched=[measuredProperty, statisticType, unitFamily] mismatched=2
      … +2 more candidates
- Notes: seed 014-carbonbrief: UK wind+solar vs gas

### 016-energy-charts-bsky-social (at://did:plc:giacpvcstwwynvst6rrcm5zd/app.bsky.feed.post/3mim3lxkme22c)
- Expected: Resolved
- Actual: Ambiguous
- outcome-tag: expected Resolved, got Ambiguous
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH] unexpected=[https://id.skygest.io/variable/var_01KNQEZ5WN8PY5KZKS91E7QVTB]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:giacpvcstwwynvst6rrcm5zd/bafkreifpeu7iaqezva4x7l7m4b3ddsut4cdukqhph2nzxovkfofuwocqsq agentId=— interpret=Hypothesis outcome=Ambiguous
    sharedPartial: unitFamily=energy, measuredProperty=generation, domainObject=electricity, technologyOrFuel=solar PV, statisticType=flow, aggregation=sum
    hypothesisItems=3 evidence=12
    item[0] GAP reason=required-facet-conflict missing=[]
    item[1] GAP reason=required-facet-conflict missing=[]
    item[2] BOUND variable=https://id.skygest.io/variable/var_01KNQEZ5WN8PY5KZKS91E7QVTB label=Solar electricity generation
- Notes: seed 016-energy-charts: EU-27 solar+wind Stromerzeugung

### 018-simonmahan (x://1886502618/status/2042240974177325165)
- Expected: Resolved
- Actual: NoMatch
- outcome-tag: expected Resolved, got NoMatch
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WMARTRPG4KZMWMZ82Y] unexpected=[]
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFd-O6NW4AAMX5M.jpg agentId=— interpret=Hypothesis outcome=NoMatch
    sharedPartial: domainObject=nuclear reactor, technologyOrFuel=nuclear, measuredProperty=demand
    hypothesisItems=1 evidence=3
    item[0] GAP reason=missing-required missing=[statisticType]
- Notes: seed 018-simonmahan: nuclear cooling reservoir

### 019-nicolasfulghum (x://777116516357726208/status/2042196391292817787)
- Expected: Resolved
- Actual: OutOfRegistry
- outcome-tag: expected Resolved, got OutOfRegistry
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH] unexpected=[]
- agent-scope: expected https://id.skygest.io/agent/ag_01KNQEZ5VEC3TDVM9ASP83CZC1, got —
- Trace:
  asset=embed:0:https://pbs.twimg.com/media/HFdURdpWoAAsdzi.jpg agentId=— interpret=Hypothesis outcome=OutOfRegistry
    sharedPartial: measuredProperty=generation, domainObject=natural gas, technologyOrFuel=solar PV, statisticType=flow
    hypothesisItems=1 evidence=1
    item[0] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WN8PY5KZKS91E7QVTB label="Solar electricity generation" matched=[measuredProperty, technologyOrFuel, statisticType] mismatched=1
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[measuredProperty, statisticType] mismatched=1
      candidate[2] var=var_01KP172ZRES5RNDND1J224XNS7 label="Natural gas consumption" matched=[domainObject, statisticType] mismatched=1
      … +2 more candidates
- Notes: seed 019-nicolasfulghum: UK high gas prices

### 020-lightbucket-bsky-social (at://did:plc:ii2yv4lw6nju7ynpwohqvvle/app.bsky.feed.post/3mhngjqn5nc2b)
- Expected: Resolved
- Actual: Underspecified
- outcome-tag: expected Resolved, got Underspecified
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN7HAKBFJ3TZ09VA4H] unexpected=[]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:ii2yv4lw6nju7ynpwohqvvle/bafkreibolo5bd5qtdw5mxq3sbxie2ekq2smwo4zg3fy2uwaimy5fnurv7i agentId=— interpret=Hypothesis outcome=Underspecified
    sharedPartial: unitFamily=energy, domainObject=electricity
    hypothesisItems=4 evidence=12
    item[0] GAP reason=missing-required missing=[measuredProperty, statisticType]
      candidate[0] var=var_01KNQEZ5WNXB2JR47T4ZEV0VQG label="Electricity demand" matched=[domainObject, unitFamily] mismatched=0
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[domainObject, unitFamily] mismatched=0
      candidate[2] var=var_01KNQEZ5WN8PX3N5HTEAWMF1BV label="Coal electricity generation" matched=[domainObject, unitFamily] mismatched=0
      … +2 more candidates
    item[1] GAP reason=missing-required missing=[measuredProperty, statisticType]
      candidate[0] var=var_01KNQEZ5WNXB2JR47T4ZEV0VQG label="Electricity demand" matched=[domainObject, unitFamily] mismatched=0
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[domainObject, unitFamily] mismatched=0
      candidate[2] var=var_01KNQEZ5WN8PX3N5HTEAWMF1BV label="Coal electricity generation" matched=[domainObject, unitFamily] mismatched=0
      … +2 more candidates
    item[2] GAP reason=missing-required missing=[measuredProperty, statisticType]
      candidate[0] var=var_01KNQEZ5WNXB2JR47T4ZEV0VQG label="Electricity demand" matched=[domainObject, unitFamily] mismatched=0
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[domainObject, unitFamily] mismatched=0
      candidate[2] var=var_01KNQEZ5WN8PX3N5HTEAWMF1BV label="Coal electricity generation" matched=[domainObject, unitFamily] mismatched=0
      … +2 more candidates
    item[3] GAP reason=missing-required missing=[measuredProperty, statisticType]
      candidate[0] var=var_01KNQEZ5WNXB2JR47T4ZEV0VQG label="Electricity demand" matched=[domainObject, unitFamily] mismatched=0
      candidate[1] var=var_01KNQEZ5WN5TNH2HCGMHA2T3YH label="Electricity generation" matched=[domainObject, unitFamily] mismatched=0
      candidate[2] var=var_01KNQEZ5WN8PX3N5HTEAWMF1BV label="Coal electricity generation" matched=[domainObject, unitFamily] mismatched=0
      … +2 more candidates
- Notes: seed 020-lightbucket: 50 years electricity decarbonisation

### 021-lightbucket-bsky-social (at://did:plc:ii2yv4lw6nju7ynpwohqvvle/app.bsky.feed.post/3mhnvtgx52k2e)
- Expected: Resolved
- Actual: Ambiguous
- outcome-tag: expected Resolved, got Ambiguous
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WNXB2JR47T4ZEV0VQG] unexpected=[]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:ii2yv4lw6nju7ynpwohqvvle/bafkreiewqts4jhzqec4rlfcv4htyvirogfdnmsyhpuy7a3kuibpixitwem agentId=— interpret=Hypothesis outcome=Ambiguous
    sharedPartial: measuredProperty=consumption, domainObject=natural gas, technologyOrFuel=natural gas, unitFamily=power, aggregation=max
    hypothesisItems=1 evidence=9
    item[0] GAP reason=required-facet-conflict missing=[]
- Notes: seed 021-lightbucket: per capita natural gas EU

### 022-klstone-bsky-social (at://did:plc:eokofv4mj6egxuhucqseamtz/app.bsky.feed.post/3mitdstlgtc2q)
- Expected: Resolved
- Actual: Resolved
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH] unexpected=[https://id.skygest.io/variable/var_01KNQEZ5WNBVQ06R676YPBZRE2]
- Trace:
  asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:eokofv4mj6egxuhucqseamtz/bafkreib6f4xytwhtqp5q4ymhnvgtcfx7ibpct7p3pvq66i2tspankwucuu agentId=— interpret=Hypothesis outcome=Resolved
    sharedPartial: measuredProperty=generation, domainObject=electricity, technologyOrFuel=wind, statisticType=flow, aggregation=sum, unitFamily=energy
    hypothesisItems=1 evidence=4
    item[0] BOUND variable=https://id.skygest.io/variable/var_01KNQEZ5WNBVQ06R676YPBZRE2 label=Wind electricity generation
- Notes: seed 022-klstone: DE Stromerzeugung

### 024-lightbucket-bsky-social (at://did:plc:ii2yv4lw6nju7ynpwohqvvle/app.bsky.feed.post/3mhxnfgkqjs27)
- Expected: Resolved
- Actual: OutOfRegistry
- outcome-tag: expected Resolved, got OutOfRegistry
- variable-ids: missing=[https://id.skygest.io/variable/var_01KNQEZ5WN5TNH2HCGMHA2T3YH] unexpected=[]
- Trace:
  asset=media:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:ii2yv4lw6nju7ynpwohqvvle/bafkreih6tawpy6iubxuzkaag2qutbo5bvn7llsl7eybtyld7og3sa5nx7a agentId=— interpret=Hypothesis outcome=OutOfRegistry
    sharedPartial: measuredProperty=generation, domainObject=electricity, statisticType=flow, technologyOrFuel=nuclear, unitFamily=energy
    hypothesisItems=1 evidence=4
    item[0] GAP reason=no-candidates missing=[]
      candidate[0] var=var_01KNQEZ5WN8PX3N5HTEAWMF1BV label="Coal electricity generation" matched=[measuredProperty, domainObject, statisticType, unitFamily] mismatched=1
      candidate[1] var=var_01KNQEZ5WN8PY5KZKS91E7QVTB label="Solar electricity generation" matched=[measuredProperty, domainObject, statisticType, unitFamily] mismatched=1
      candidate[2] var=var_01KNQEZ5WNBVQ06R676YPBZRE2 label="Wind electricity generation" matched=[measuredProperty, domainObject, statisticType, unitFamily] mismatched=1
      … +2 more candidates
- Notes: seed 024-lightbucket: Germany numerical coincidence

## Unannotated bundles (candidates for new ground truth)

### 008-ben-inskeep (x://2687569825/status/2042291388335694128)
- asset=embed:1:https://pbs.twimg.com/media/HFeslxoWYAAZIcp.png actualTag=NoMatch boundVars=[] gap=—
- asset=embed:2:https://pbs.twimg.com/media/HFeslxsXkAAMmJT.png actualTag=Ambiguous boundVars=[] gap=no-candidates

### 011-thomashochman (x://900122526474354688/status/2042070324481589299)
- asset=embed:0:https://pbs.twimg.com/media/HFbjn_1WIAAN5ys.jpg actualTag=Conflicted boundVars=[] gap=required-facet-conflict

### 015-josephmooneymp (x://1309223351055872000/status/2038197281284096309)
- asset=embed:0:https://pbs.twimg.com/media/HEkhnpNawAAohLV.jpg actualTag=NoMatch boundVars=[] gap=—
- asset=embed:1:https://pbs.twimg.com/media/HEkhnu2aEAA9WH2.jpg actualTag=NoMatch boundVars=[] gap=—

### 017-climateinstit (x://1173979439501336576/status/2042237406850523163)
- asset=embed:0:https://pbs.twimg.com/media/HFd8GVbWIAAvgat.jpg actualTag=OutOfRegistry boundVars=[] gap=no-candidates

### 023-ben-inskeep (x://2687569825/status/2041574398801391777)
- asset=embed:0:https://pbs.twimg.com/media/HFUg19Ka8AIGWNz.png actualTag=NoMatch boundVars=[] gap=—

### 025-joshdr83 (x://304177743/status/2042024733798232066)
- asset=embed:0:https://video.twimg.com/amplify_video/2042024585277927425/vid/avc1/1280x720/ANLN6pr0EFM-iJZH.mp4?tag=14 actualTag=NoMatch boundVars=[] gap=—

### 026-hausfath-bsky-social (at://did:plc:r5ofoghdcbtjqiujqpvja4uh/app.bsky.feed.post/3mif3epqb7t2r)
- asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:r5ofoghdcbtjqiujqpvja4uh/bafkreiexvmf2oqhx4bshy3hwaojfdq4j7bu2m722vwrbeilppmh4kdrvda actualTag=NoMatch boundVars=[] gap=—

### 027-lightbucket-bsky-social (at://did:plc:ii2yv4lw6nju7ynpwohqvvle/app.bsky.feed.post/3migue6dcyc25)
- asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:ii2yv4lw6nju7ynpwohqvvle/bafkreighdh6kphuvzeq5bkf5s7gxtgrfeospsswsees6ma26zkfidyem64 actualTag=OutOfRegistry boundVars=[] gap=no-candidates

### 028-josephmooneymp (x://1309223351055872000/status/2041067813700518365)
- asset=embed:0:https://pbs.twimg.com/media/HFNUWxsaQAE2I7f.jpg actualTag=Conflicted boundVars=[] gap=required-facet-conflict

### 029-ben-inskeep (x://2687569825/status/2040488919955898559)
- asset=embed:0:https://pbs.twimg.com/media/HFFDqTiagAAPelc.png actualTag=NoMatch boundVars=[] gap=—
- asset=embed:1:https://pbs.twimg.com/media/HFFDqTeaAAAef6H.png actualTag=NoMatch boundVars=[] gap=—
- asset=embed:2:https://pbs.twimg.com/media/HFFDqThbAAAzbDz.jpg actualTag=NoMatch boundVars=[] gap=—
- asset=embed:3:https://pbs.twimg.com/media/HFFFIeXaoAAOnHK.png actualTag=NoMatch boundVars=[] gap=—

### 030-hausfath-bsky-social (at://did:plc:r5ofoghdcbtjqiujqpvja4uh/app.bsky.feed.post/3mijii75bf72l)
- asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:r5ofoghdcbtjqiujqpvja4uh/bafkreiadkheq4jz5irtqtdpprbv2pcen2kr4vmdn2lrwjgu3q4urh7iave actualTag=NoMatch boundVars=[] gap=—

### 031-thierryaaron-bsky-social (at://did:plc:yyjm6azqeob2dqgn47e4g6uf/app.bsky.feed.post/3mil6lnsrqc26)
- asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:yyjm6azqeob2dqgn47e4g6uf/bafkreidobhklcv6wgmkqx4r6rubdu3xeauvxmdchjr6ibjjffqtn7w64h4 actualTag=NoMatch boundVars=[] gap=—

### 032-electricfelix-bsky-social (at://did:plc:xf53ujprnmfktaxb77fztor6/app.bsky.feed.post/3mhvtzm4l4c26)
- asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:xf53ujprnmfktaxb77fztor6/bafkreiao6krdzntkzuo7ox2unwkkqok7locbddfteil6efad5odazdlocq actualTag=Ambiguous boundVars=[] gap=missing-required

### 033-simonmahan (x://1886502618/status/2041680596435390522)
- asset=embed:0:https://video.twimg.com/amplify_video/2041507927165386752/vid/avc1/1920x1080/_ejcUA9CqToEIcZH.mp4?tag=21 actualTag=NoMatch boundVars=[] gap=—

### 034-klstone-bsky-social (at://did:plc:eokofv4mj6egxuhucqseamtz/app.bsky.feed.post/3mimw5siojc25)
- asset=embed:0:https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:eokofv4mj6egxuhucqseamtz/bafkreianivayiak562hjie7npdhqfk2jxcgzsn6vtgkx4n6yw46yke5ctu actualTag=Ambiguous boundVars=[] gap=no-candidates

### 035-tylerhnorris (x://23008743/status/1893380642701754563)
- asset=embed:0:https://pbs.twimg.com/media/GkajKoqWsAA9wGS.png actualTag=NoMatch boundVars=[] gap=—

### 036-hausfath-bsky-social (at://did:plc:r5ofoghdcbtjqiujqpvja4uh/app.bsky.feed.post/3mhizmc3k4k2r)
- asset=post-text actualTag=NoMatch boundVars=[] gap=—

### 037-justingerdes-bsky-social (at://did:plc:dw4r3ezs6vu7wkfqo2lczddn/app.bsky.feed.post/3mhjmcnprvk2j)
- asset=post-text actualTag=NoMatch boundVars=[] gap=—
