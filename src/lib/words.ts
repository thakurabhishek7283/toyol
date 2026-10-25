// Starting vocabulary for autocompletion, before it has learned from use.
// Common English words roughly by frequency (only those worth completing: three
// letters or more), then terms that come up in technical and interview
// questions. lib/autocomplete ranks earlier words higher.

const COMMON = `
the and that have for not with you this but his from they say her she will one all would there their what
out about who get which when make can like time just him know take people into year your good some could them
see other than then now look only come its over think also back after use two how our work first well way even
new want because any these give day most us is are was were been being has had does did doing done said made
should may might must shall need why where while before between through during without within under again
further once here both each few more such own same too very can't don't doesn't isn't aren't wasn't won't
what's how's why's where's there's it's that's let's i'm you're they're we're i've you've we've i'd you'd
explain describe define compare difference differences between example examples meaning mean means
happen happens happened happening work works worked working actually basically really usually generally
important importance better best worse worst difference different similar same opposite advantage advantages
disadvantage disadvantages benefit benefits drawback drawbacks pros cons tradeoff tradeoffs trade-off trade-offs
reason reasons cause causes effect effects result results purpose problem problems solution solutions
approach approaches method methods technique techniques strategy strategies process processes step steps
way ways case cases situation situations scenario scenarios question questions answer answers
idea ideas concept concepts definition definitions overview summary detail details
improve improving increase decrease reduce prevent avoid handle handling manage managing choose choosing
create creating build building design designing implement implementing write writing read reading
calculate calculating solve solving find finding check checking test testing debug debugging fix fixing
start starting stop stopping run running change changing update updating remove removing add adding
learn learning understand understanding think thinking know knowing remember tell telling show showing
help helping give giving keep keeping call calling try trying turn turning move moving become becoming
should would could will might can cannot able possible impossible likely unlikely necessary required
when whenever whether either neither instead rather otherwise however therefore although though unless
because since until while during after before above below inside outside across along around against
about among toward towards upon onto into from with within without through throughout
something anything everything nothing someone anyone everyone nobody somewhere anywhere everywhere
always never often sometimes usually rarely already still yet just only even also
first second third last next previous final main major minor primary secondary basic simple complex
large small big little long short high low fast slow quick early late easy hard difficult common rare
good bad right wrong true false real fake correct incorrect valid invalid safe unsafe secure
number numbers value values amount total average maximum minimum percent percentage rate ratio
time times date dates day days week weeks month months year years hour hours minute minutes second seconds
world country company business market customer customers product products service services
team teams project projects manager management leader leadership role responsibility responsibilities
experience experiences skill skills strength strengths weakness weaknesses challenge challenges
conflict conflicts mistake mistakes failure failures success successes goal goals feedback
interview interviewer candidate position salary career opportunity opportunities
history science economics finance financial money price prices cost costs profit revenue growth
health medical medicine disease treatment symptoms
`;

const TECH = `
algorithm algorithms data structure structures array arrays list lists linked stack stacks queue queues
heap heaps tree trees binary graph graphs hash table tables map maps set sets string strings integer
integers float boolean pointer pointers reference references object objects class classes interface
interfaces function functions method parameter parameters argument arguments variable variables constant
recursion recursive iteration iterative loop loops sorting sort search searching traversal
complexity time-complexity space-complexity big-o logarithmic linear quadratic exponential constant
dynamic programming memoization greedy backtracking divide conquer sliding window two pointers
breadth-first depth-first BFS DFS Dijkstra shortest path topological minimum spanning
database databases SQL NoSQL query queries index indexes indexing join joins transaction transactions
normalization denormalization schema schemas primary foreign key keys constraint constraints
consistency availability partition tolerance CAP ACID BASE eventual replication sharding partitioning
scalability scalable horizontal vertical scaling latency throughput bandwidth performance optimization
cache caching CDN load balancer balancing proxy reverse gateway microservice microservices monolith
distributed system systems architecture design pattern patterns singleton factory observer
API APIs REST RESTful GraphQL gRPC HTTP HTTPS TCP UDP IP DNS TLS SSL WebSocket WebSockets JSON XML
request requests response responses endpoint endpoints status header headers authentication
authorization OAuth JWT token tokens session sessions cookie cookies password encryption hashing
security vulnerability vulnerabilities injection XSS CSRF CORS firewall
server servers client clients browser frontend backend full-stack framework frameworks library libraries
JavaScript TypeScript Python Java Kotlin Swift Go Golang Rust C++ C# Ruby PHP Scala
React Angular Vue Svelte Next.js Node.js Express Django Flask FastAPI Spring Spring Boot .NET
HTML CSS DOM component components state props hook hooks useState useEffect useMemo useCallback
render rendering virtual event events callback callbacks promise promises async await asynchronous
synchronous concurrency concurrent parallel parallelism thread threads process processes mutex lock
locks deadlock race condition semaphore memory leak garbage collection stack overflow
operating kernel virtual memory paging scheduling CPU GPU cores
Linux Windows macOS shell bash terminal command line
Docker container containers Kubernetes pod pods deployment deployments cluster clusters node nodes
cloud AWS Azure GCP serverless Lambda S3 EC2 storage bucket
Git GitHub branch branches merge merging rebase commit commits pull request version control
CI/CD pipeline pipelines build deploy deploying deployment testing unit integration end-to-end
monitoring logging metrics observability alerting incident incidents outage
Redis Kafka RabbitMQ PostgreSQL MySQL MongoDB Cassandra DynamoDB Elasticsearch SQLite
message messages queue broker producer consumer publish subscribe pub/sub event-driven streaming
machine learning model models training inference dataset datasets feature features label labels
neural network networks deep transformer transformers attention self-attention embedding embeddings
LLM LLMs RAG prompt prompts fine-tuning tokenizer classification regression clustering
overfitting underfitting accuracy precision recall gradient descent loss
statistics probability distribution mean median variance standard deviation hypothesis
object-oriented functional programming inheritance polymorphism encapsulation abstraction
immutable mutable immutability idempotent idempotency stateless stateful
`;

export const SEED_WORDS: string[] = `${COMMON} ${TECH}`.split(/\s+/).filter((w) => w.length >= 3);

// How questions usually start, for completing an opening and for the next word
export const SEED_PHRASES: string[] = [
  'what is the difference between',
  "what's the difference between",
  'what is the best way to',
  'what are the pros and cons of',
  'what are the advantages of',
  'what are the disadvantages of',
  'what happens when',
  'what happens if',
  'what does it mean',
  'what is the time complexity of',
  'how does it work',
  'how do I',
  'how do you',
  'how would you design',
  'how would you',
  'how can I',
  'how to',
  'how many',
  'how much',
  'why does',
  'why do',
  'why is',
  'why would you',
  'when should I use',
  'when would you use',
  'which is better',
  'can you explain',
  'explain the difference between',
  'explain how',
  'give me an example of',
  'walk me through',
  'tell me about a time when',
  'tell me about yourself',
  'compare and contrast',
  'is it possible to',
  'is there a way to',
  'should I use',
  'difference between',
];
