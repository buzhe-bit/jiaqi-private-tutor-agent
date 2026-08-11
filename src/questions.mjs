const QUESTIONS = [
  {
    id: "kant-freedom-keystone",
    text: "在康德哲学中，自由‘构成了纯粹的，甚至思辨理性体系的整个建筑的拱顶石’。试从理论理性和实践理性两个层次说明之。",
    domain: "西方哲学",
    subject: "philosophy",
    topic: "康德的自由问题",
    thinker: "康德",
    type: "论述题",
    source: "历年真题",
    concepts: ["理论理性", "实践理性", "自由", "道德法则"],
    knowledgeRelations: ["理论理性为自由留下可能，实践理性赋予自由实践意义"],
    questionKind: "relation",
    origin: "past_exam",
    sourceStatus: "material_supported",
    sourceLabel: "历年真题",
    reviewStatus: "reviewed",
    guide: {
      focus: "理论理性为自由留下可能，实践理性通过道德法则赋予自由实践意义。",
      answerHook: "康德要解决自然因果与道德责任怎样同时成立的问题。",
      explanation: "理论理性把知识限制在现象界，不能证明自由，却也不能越界否定自由；实践理性从道德法则出发，必须预设主体能够自由地自我规定。",
      answerStructure: [
        "理论理性：自然因果支配现象界，给自由留下可思空间。",
        "实践理性：道德法则要求主体能够自我规定，使自由成为实践必需的预设。",
        "体系连接：前者清出位置，后者赋予作用，自由由此连接认识限界与道德责任。"
      ],
      possibleAnswer: "康德并不是说理论理性已经证明了自由。理论理性把知识限制在可能经验与现象界，自然因果因而不能越界否定物自身层面的自由，这为自由留下了可思的可能。实践理性则从道德法则出发：无条件的‘应当’预设主体能够依理性自我规定，因此自由虽不是理论知识，却获得实践上的确证。理论理性为自由清出位置，实践理性使自由承担道德主体成立的条件，自由由此成为批判哲学体系的拱顶石。",
      nextRecallQuestion: "理论理性为自由做了什么？实践理性补上了什么？两者为什么使自由成为拱顶石？",
      keyTerms: ["理论理性", "实践理性", "自由", "道德法则"]
    }
  },
  {
    id: "kant-phenomena-noumena",
    text: "康德为什么要区分现象与物自体？",
    domain: "西方哲学",
    subject: "philosophy",
    topic: "康德的认识边界",
    thinker: "康德",
    type: "简答题",
    source: "历年真题",
    concepts: ["现象", "物自体", "认识条件", "知识边界"],
    knowledgeRelations: ["现象可知与物自体不可知共同划定知识边界"],
    questionKind: "new",
    origin: "past_exam",
    sourceStatus: "material_supported",
    sourceLabel: "历年真题",
    reviewStatus: "reviewed",
    guide: {
      focus: "区分现象与物自体，是为了同时说明知识何以可能以及知识的边界在哪里。",
      answerHook: "这一区分既为经验知识奠基，也阻止理性把经验条件误当成事物本身的条件。",
      explanation: "现象是对象依照人的感性形式和知性范畴呈现给我们的样子，因此能够成为知识；物自体指对象不依赖这种认识条件时的存在，它可以被思，但不能被理论地认识。",
      answerStructure: [
        "认识条件：人的知识总经由感性形式和知性范畴形成，只能把握现象。",
        "限界作用：物自体标出知识不能越过的边界，防止形而上学独断。",
        "体系意义：这既保证经验科学的有效性，也为自由等实践理念留下不可被理论否定的位置。"
      ],
      possibleAnswer: "康德区分现象与物自体，首先是为了说明经验知识何以可能。对象只有在人的感性形式和知性范畴中呈现，才成为可认识的现象。其次，这一区分也给知识划定边界：物自体作为不依赖人的认识条件而存在的对象，只能被思而不能被理论认识。由此，康德一方面保证自然科学在现象界中的有效性，另一方面阻止理性把经验条件扩张为一切存在的条件，并为自由等实践理念留下不能被理论理性排除的位置。",
      nextRecallQuestion: "现象为什么可知？物自体为什么不可知？这个边界解决了康德的什么问题？",
      keyTerms: ["现象", "物自体", "认识条件", "知识边界"]
    }
  },
  {
    id: "hegel-dialectic",
    text: "简述黑格尔的辩证法思想。",
    domain: "西方哲学",
    subject: "philosophy",
    topic: "黑格尔辩证法",
    thinker: "黑格尔",
    type: "简答题",
    source: "历年真题",
    concepts: ["内在矛盾", "否定", "扬弃", "具体统一"],
    knowledgeRelations: ["有限规定因内在矛盾而运动，并通过扬弃走向具体统一"],
    questionKind: "new",
    origin: "past_exam",
    sourceStatus: "material_supported",
    sourceLabel: "历年真题",
    reviewStatus: "reviewed",
    guide: {
      focus: "辩证法不是外加的三段公式，而是概念因自身矛盾而运动、扬弃并走向更具体统一的过程。",
      answerHook: "黑格尔要说明，真实不是静止实体，而是通过否定和扬弃实现自身的整体过程。",
      explanation: "每个有限规定都包含自身的界限和否定，这种内在矛盾推动它超出自身；扬弃既取消片面性，又保存其中合理内容，在更具体的统一中发展。",
      answerStructure: [
        "出发点：真理是主体性的整体和发展过程，不是孤立、静止的规定。",
        "运动机制：有限规定因内在矛盾发生否定，经过否定之否定和扬弃走向更具体的统一。",
        "方法与存在统一：辩证法既是概念认识的方法，也是事物自身发展的逻辑。"
      ],
      possibleAnswer: "黑格尔的辩证法旨在把握事物和概念自身的运动。任何有限规定都不是封闭、自足的，它在规定自身时也包含界限和否定，由此产生内在矛盾并推动自身超越。新的阶段不是简单抛弃旧阶段，而是通过‘扬弃’取消其片面性，同时保存其合理内容，形成更具体、更丰富的统一。因此，辩证法不能被简化为外加于对象的正反合公式；它既是概念展开的认识方法，也是现实自身发展的逻辑。真理也不是孤立结论，而是这一发展过程所形成的整体。",
      nextRecallQuestion: "矛盾为什么会推动运动？扬弃保留和取消了什么？为什么辩证法不等于机械的正反合？",
      keyTerms: ["内在矛盾", "否定", "扬弃", "具体统一"]
    }
  },
  {
    id: "legalism-basic-thought",
    text: "简述法家基本思想。",
    domain: "中国哲学",
    subject: "philosophy",
    topic: "先秦法家思想",
    thinker: "法家",
    type: "简答题",
    source: "佳琦真题语料",
    concepts: ["法", "术", "势", "富国强兵"],
    knowledgeRelations: ["法提供公开规范，术保障君主控驭，势提供权力条件"],
    questionKind: "new",
    origin: "past_exam",
    sourceStatus: "ai_synthesized",
    sourceLabel: "题干来自佳琦真题语料；讲解为 AI 综合解释",
    reviewStatus: "unreviewed",
    guide: {
      focus: "法家以富国强兵和建立有效秩序为目标，把法、术、势组织成一套治理结构。",
      answerHook: "法家面对礼制失效、诸侯竞争的现实，关心的是怎样建立可执行、可控制的政治秩序。",
      explanation: "法是公开而统一的赏罚规范，术是君主驾驭群臣和考核名实的方法，势是统治得以生效的权位。三者不是术语并列，而是规范、操作与权力条件的配合。",
      answerStructure: [
        "问题背景：礼崩乐坏和兼并竞争要求新的治理方式。",
        "核心结构：法定规范、术控官僚、势保权威。",
        "理论特征：重现实功效与制度约束，同时说明其权力集中倾向。"
      ],
      possibleAnswer: "法家产生于诸侯竞争和传统礼制失效的背景中，目标是以可执行的制度实现富国强兵和政治秩序。其基本思想可由法、术、势三方面把握：法是公开统一的赏罚规范，使治理不依赖私人好恶；术是君主考核名实、驾驭群臣的方法；势是权位所形成的政治力量，使法与术能够生效。三者共同把治理从德性教化转向制度、技术和权力结构，但也容易强化君主集权并压缩社会主体的自主空间。",
      nextRecallQuestion: "法、术、势各解决什么问题？为什么它们必须配合？",
      keyTerms: ["法", "术", "势", "富国强兵"]
    }
  },
  {
    id: "confucianism-mohism-difference",
    text: "论述儒家和墨家的区别。",
    domain: "中国哲学",
    subject: "philosophy",
    topic: "先秦儒墨比较",
    thinker: "儒家与墨家",
    type: "论述题",
    source: "佳琦真题语料",
    concepts: ["仁爱", "兼爱", "礼", "尚贤"],
    knowledgeRelations: ["儒家由亲亲推扩仁爱，墨家以兼爱批评差等秩序"],
    questionKind: "relation",
    origin: "past_exam",
    sourceStatus: "ai_synthesized",
    sourceLabel: "题干来自佳琦真题语料；讲解为 AI 综合解释",
    reviewStatus: "unreviewed",
    guide: {
      focus: "儒墨都回应社会失序，但儒家从有差等的亲亲仁爱恢复礼序，墨家以兼爱和尚贤追求更平等、功利的秩序。",
      answerHook: "比较题不能只列主张，要说明两家为何从相同问题走向不同的伦理与政治方案。",
      explanation: "儒家以血缘情感和礼为起点，主张爱有差等并由亲亲向外推扩；墨家批评差等之爱容易造成争夺，主张兼相爱、交相利，并以尚贤、节用等建立秩序。",
      answerStructure: [
        "共同问题：礼崩乐坏与社会冲突。",
        "根本分歧：差等仁爱与兼爱，礼乐教化与功利标准。",
        "评价影响：两者分别凸显关系伦理与平等互利的治理想象。"
      ],
      possibleAnswer: "儒家与墨家都试图回应先秦社会失序，但出发点和解决路径不同。儒家以亲亲之情为仁爱的起点，承认爱有差等，并通过礼把家庭伦理推展为政治秩序；墨家则认为差等之爱会造成家国之间的争夺，主张兼相爱、交相利，并以尚贤、节用等标准追求可验证的社会功效。因而，儒家更重关系中的德性培养和礼乐教化，墨家更强调平等关切、公共利益和制度功效。两者的争论显示了秩序究竟应建立在差等伦理还是普遍互利之上的根本分歧。",
      nextRecallQuestion: "儒墨面对什么共同问题？仁爱与兼爱的根本差别在哪里？",
      keyTerms: ["仁爱", "兼爱", "礼", "尚贤"]
    }
  },
  {
    id: "mencius-develops-confucius-ren",
    text: "论述孟子学说对孔子仁学理论的发展。",
    domain: "中国哲学",
    subject: "philosophy",
    topic: "孟子对孔子仁学的发展",
    thinker: "孔子与孟子",
    type: "论述题",
    source: "佳琦真题语料",
    concepts: ["仁", "性善", "四端", "仁政"],
    knowledgeRelations: ["孟子以性善和四端为仁提供人性基础，并将其展开为仁政"],
    questionKind: "relation",
    origin: "past_exam",
    sourceStatus: "ai_synthesized",
    sourceLabel: "题干来自佳琦真题语料；讲解为 AI 综合解释",
    reviewStatus: "unreviewed",
    guide: {
      focus: "孟子把孔子的仁从伦理要求推进为以性善、四端为基础，并通向仁政的理论体系。",
      answerHook: "题目不是分别介绍孔孟，而是找出孟子补上了仁的根据、实现路径和政治展开。",
      explanation: "孔子以仁为核心德性并强调克己复礼、推己及人；孟子用不忍人之心和四端说明仁的内在人性根据，再通过扩充工夫和仁政把它连接到个人修养与政治秩序。",
      answerStructure: [
        "继承：仁作为人的核心德性和社会秩序根据。",
        "发展：性善与四端说明仁何以可能，扩充说明如何实现。",
        "政治化：由不忍人之心推到不忍人之政。"
      ],
      possibleAnswer: "孟子继承了孔子以仁为核心的伦理方向，但把仁发展成更完整的理论。孔子主要通过克己复礼、忠恕和推己及人说明仁的实践要求；孟子进一步以性善论和四端说为仁提供人性根据，认为恻隐之心是仁之端，人可以通过保存、扩充这些道德萌芽成为有德之人。同时，他把个人的不忍人之心推展为不忍人之政，使仁从人格修养进入王道政治。由此，孟子补足了仁何以可能、如何实现以及怎样进入政治生活三个层次。",
      nextRecallQuestion: "孟子分别从人性根据、修养工夫和政治实践三个层次补上了什么？",
      keyTerms: ["仁", "性善", "四端", "仁政"]
    }
  },
  {
    id: "marxism-revolutionary-transformation",
    text: "论述马克思主义哲学的革命性变革。",
    domain: "马克思主义哲学",
    subject: "philosophy",
    topic: "马克思主义哲学的实践转向",
    thinker: "马克思",
    type: "论述题",
    source: "佳琦真题语料",
    concepts: ["实践", "历史唯物主义", "现实的人", "改变世界"],
    knowledgeRelations: ["马克思以现实社会实践改造旧唯物主义和唯心辩证法"],
    questionKind: "relation",
    origin: "past_exam",
    sourceStatus: "ai_synthesized",
    sourceLabel: "题干来自佳琦真题语料；讲解为 AI 综合解释",
    reviewStatus: "unreviewed",
    guide: {
      focus: "马克思以现实的人的社会实践为出发点，同时改造旧唯物主义的直观性和黑格尔辩证法的思辨性。",
      answerHook: "所谓革命性变革，不只是增加一个观点，而是改变哲学的出发点、对象、方法和功能。",
      explanation: "马克思把感性世界理解为人的社会实践和历史活动的结果，从现实的人及其物质生活关系解释意识与历史，又把辩证运动还原到现实矛盾之中，使哲学从解释世界转向参与改变世界。",
      answerStructure: [
        "出发点变化：从抽象意识或直观对象转向现实的人及其实践。",
        "理论重建：以历史唯物主义说明社会存在、意识与历史运动。",
        "功能变化：理论批判与现实变革相统一。"
      ],
      possibleAnswer: "马克思主义哲学的革命性变革首先在于实践观点的确立。马克思既批评旧唯物主义把对象当作与人的活动无关的直观客体，也批评黑格尔把现实运动归结为概念或精神的运动，转而从现实的人、物质生活条件和社会实践理解世界。由此，唯物主义被推进为历史唯物主义，意识和制度被放回具体社会关系中说明；辩证法也从思辨概念的展开转向现实矛盾和实践过程。哲学的功能随之改变：它不再满足于解释世界，而要在批判现实的同时参与改变世界。",
      nextRecallQuestion: "马克思分别改造了旧唯物主义和黑格尔辩证法的什么局限？实践起了什么作用？",
      keyTerms: ["实践", "历史唯物主义", "现实的人", "改变世界"]
    }
  },
  {
    id: "socrates-virtue",
    text: "简述苏格拉底的德性论。",
    domain: "西方哲学",
    subject: "philosophy",
    topic: "苏格拉底德性论",
    thinker: "苏格拉底",
    type: "简答题",
    source: "佳琦真题语料",
    concepts: ["德性即知识", "无知", "灵魂关怀", "反诘法"],
    knowledgeRelations: ["德性依赖对善的认识，作恶被解释为无知，哲学因而成为灵魂关怀"],
    questionKind: "new",
    origin: "past_exam",
    sourceStatus: "ai_synthesized",
    sourceLabel: "题干来自佳琦真题语料；讲解为 AI 综合解释",
    reviewStatus: "unreviewed",
    guide: {
      focus: "苏格拉底把德性与对善的知识联系起来，并以承认无知和反诘对话推动灵魂自我检验。",
      answerHook: "苏格拉底把哲学重心转向人应当怎样生活，德性论就是对善的知识怎样指导生活的回答。",
      explanation: "德性即知识意味着真正知道善的人会趋向善，错误行为源于对善的无知。承认无知不是放弃判断，而是通过反诘揭露自以为知，促使人关怀灵魂和追求经过检验的生活。",
      answerStructure: [
        "问题转向：由自然研究转向善的生活和灵魂。",
        "核心命题：德性即知识，作恶源于无知。",
        "实践方法：承认无知、反诘与自我检验。"
      ],
      possibleAnswer: "苏格拉底的德性论以‘德性即知识’为核心。他认为善的生活不是依赖财富、权势或习俗，而取决于灵魂是否真正认识善；一个人若真正知道什么是善，就会趋向善，作恶则根源于无知。因此，苏格拉底强调承认自己的无知，并通过反诘法检查未经反思的意见。哲学由此成为对灵魂的关怀：人要不断追问概念和生活理由，使自己的行动接受理性的检验。这一理论强化了德性的理性基础，但也容易低估欲望、意志和情境对行为的影响。",
      nextRecallQuestion: "德性即知识怎样解释作恶？承认无知和反诘法为什么属于德性实践？",
      keyTerms: ["德性即知识", "无知", "灵魂关怀", "反诘法"]
    }
  },
  {
    id: "descartes-cogito-first-principle",
    text: "简述并分析笛卡尔的形而上学第一原理‘我思故我在’。",
    domain: "西方哲学",
    subject: "philosophy",
    topic: "笛卡尔的我思",
    thinker: "笛卡尔",
    type: "简答题",
    source: "佳琦真题语料",
    concepts: ["方法怀疑", "我思", "确定性", "思维实体"],
    knowledgeRelations: ["方法怀疑无法消除正在怀疑的思维活动，因此我思成为确定性的起点"],
    questionKind: "new",
    origin: "past_exam",
    sourceStatus: "ai_synthesized",
    sourceLabel: "题干来自佳琦真题语料；讲解为 AI 综合解释",
    reviewStatus: "unreviewed",
    guide: {
      focus: "方法怀疑可以怀疑一切对象，却不能取消当下正在怀疑和思维的活动，我思因此成为不可怀疑的确定性起点。",
      answerHook: "笛卡尔要为知识找到一个不再依赖可疑感觉和传统权威的第一原则。",
      explanation: "即使感官、身体甚至推理都可能受骗，只要我正在怀疑，就已经有思维活动发生；我思故我在不是普通三段论，而是思维行动中的直接自证。",
      answerStructure: [
        "方法背景：普遍怀疑寻找不可动摇的起点。",
        "论证核心：怀疑本身证明思维活动及思维者的存在。",
        "意义与限度：奠定主体确定性，同时留下心物关系问题。"
      ],
      possibleAnswer: "笛卡尔以方法怀疑清除一切可能出错的信念，试图为知识找到不可动摇的第一原理。感官可能欺骗我，外部世界和身体也可以被设想为不存在，但当我正在怀疑时，怀疑本身就是一种思维活动；只要有思维，就不能否认作为思维者的我在这一刻存在。因此，‘我思故我在’不是从一般前提推导出的普通三段论，而是在思维行动中的直接确定性。它使主体的自我意识成为近代哲学的出发点，也进一步引出思维实体与广延实体怎样关联的问题。",
      nextRecallQuestion: "为什么方法怀疑不能怀疑掉我思？我思为何不是普通三段论？",
      keyTerms: ["方法怀疑", "我思", "确定性", "思维实体"]
    }
  }
];

export const DEFAULT_QUESTION_ID = QUESTIONS[0].id;

export function getQuestion(id = DEFAULT_QUESTION_ID) {
  return QUESTIONS.find((question) => question.id === id) || null;
}

export function publicQuestions() {
  return QUESTIONS.map(({ guide, ...question }) => ({ ...question }));
}


export function questionSeeds() {
  return QUESTIONS.map((question) => ({
    questionId: question.id,
    stem: question.text,
    subject: question.subject,
    topic: question.topic,
    thinker: question.thinker,
    concepts: [...question.concepts],
    knowledgeRelations: [...question.knowledgeRelations],
    questionKind: question.questionKind,
    origin: question.origin,
    parentQuestionId: "",
    guide: structuredClone(question.guide),
    sourceStatus: question.sourceStatus,
    sourceLabel: question.sourceLabel,
    sourceRefs: [],
    reviewStatus: question.reviewStatus
  }));
}


export function storedQuestionToRuntime(question) {
  if (!question?.questionId || !question?.stem || !question?.guide) return null;
  return {
    id: question.questionId,
    text: question.stem,
    domain: question.domain || "西方哲学",
    subject: question.subject || "philosophy",
    topic: question.topic || "",
    thinker: question.thinker || "",
    type: question.type || "复习题",
    source: question.sourceLabel || "AI 复习变式",
    concepts: Array.isArray(question.concepts) ? [...question.concepts] : [],
    knowledgeRelations: Array.isArray(question.knowledgeRelations)
      ? [...question.knowledgeRelations]
      : [],
    questionKind: question.questionKind || "new",
    origin: question.origin || "ai_variant",
    sourceStatus: question.sourceStatus || "unverified",
    sourceLabel: question.sourceLabel || "",
    reviewStatus: question.reviewStatus || "unreviewed",
    reviewContext: question.reviewContext ? structuredClone(question.reviewContext) : null,
    guide: structuredClone(question.guide)
  };
}
