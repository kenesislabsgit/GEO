What is the cost taking for one free run , pro plan for a website and 20 questions ??
What is the profit that we need to look for in the pricing , how much we should keep for that ?
What is the best that we can offer for them so it is reasonable to have them subscribed , what we can do so that they can come to website again and again(how much cost would we need for that approx)

- 0.07doll for one free audit , if it is scaled to 100 users tried for free then cost = 7 dollors in openai credits . 

PENDING :
- picking right citations ??
- Is answers are correctyl coming from the open AI ?? Need to change the *system prompt* for it ?? or is it because of wrong *questions* ?? Inspect those manually 
- 

If we are not using the md file anywhere why should we create that ?? So we dont need to and I have a doubt regarding what we show in the frontend .If we are not using the generated reprot in the frontend what else is used ?



TODAY-

REMOVE THE UNWANTED STEP OF SEEING THE COMPETITIOR 
* Changing the monitoring and alerts flow in such a way where plus plan users can get four weekly audits with 5 questions each . All five questions are same and could be defined by the user itself , either by taking previous audit questions or writing it manually . Once the settings are saved for this weekly audit in monitoring , we run the same weekly and then alerts would mention about these in it which makes sense when we compare output with respect to same set of questions


TO BE DONE :

* NEED TO MAKE A JOB FOR THE WEEKLY AUDITS
* TRY RUNNING THE MONITORING AUDIT BY SCHEDULING A TIME THAT IS CLOSE TO CURRENT TIME AND SEE THE TRIGGER WORKING AND SEE THE OUTPUT .
* SEE THE ALERTS ACCURACY AND WHETHER IT WOULD WORK .
* THE USER ACCOUNT IS CURRENTLY IN PLUS PLAN .... WHEN WE GO TO BILLING PAGE IT IS SHOWING THE PLAN WHERE THEY CAN CICK BUTTON AND SUBSCRIBE IS THIS A NORMAL BEHAVIOUR OR SHOWN BECAUSE THE CREDITS ARE OVER ..??
* WOULD THE MANAGE SUBSCRIPTION BUTTON IN BILLING SHOWN FOR END USER ALSO ??
* IN SETTINGS WE HAE SOMETHING CALLED SIGN IN METHODS , WHY DO WE NEED THAT ?? AND A STATIC SENTENCE ABOUT PASSWORD WHY DO WE NEED THAT , ACTIVE SESSIOSN IS JUST A WORD WHY DO WE NEED THAT ? MAKE SURE EXPORT DATA BUTTON DONT GIVE ALL THOSE DATA THAT IS NOT SUPPOSE TO REACH THEM FOR EXAMPLE IN FREE AUDIT , EXPORT DATA GIVES ALL THE COMPETITORS NAME ETC.. AND THINGS THAT WE LOCKED TO NOT SHOW THEM .
* CHECK FOR CERDITS(CHECK) FOR THE USER AND UNALLOW THEM TO MAKE FURTHER EDITS BUT REST COULD BE DONE LIKE VIEWING DOWNLOADING , SEE IS IT DONE OR NOT


TO BE DONE(CODEX) :

* ADD SAFE FIRECRAWL FAILOVER: USE NORMAL CRAWLING FIRST, THEN THE PRIMARY FIRECRAWL KEY, THEN AN APPROVED BACKUP KEY ONLY WHEN THE PRIMARY KEY IS INVALID, EXHAUSTED, RATE-LIMITED, OR TEMPORARILY UNAVAILABLE. TRACK KEY HEALTH, PREVENT REPEATED RETRIES, AND CONTINUE THE AUDIT WITHOUT FIRECRAWL IF BOTH KEYS FAIL. VERIFY THE CURRENT LOCAL KEY BECAUSE THE LOOM AUDIT RETURNED HTTP 401 INVALID TOKEN.
