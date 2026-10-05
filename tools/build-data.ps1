<#
Builds the static data files used by the Kanji Trainer web app.

Sources (all free / open licence):
  * kanji meanings, readings, stroke counts .. github.com/davidluzgouveia/kanji-data  (CC BY-SA, from KANJIDIC2)
  * JLPT vocabulary ........................ github.com/jamsinclair/open-anki-jlpt-decks (CC BY)
  * example sentences ...................... Tanaka Corpus / examples.utf  (CC BY, edrdg.org)
  * stroke order SVGs ...................... github.com/KanjiVG/kanjivg (CC BY-SA 3.0)

Run:  pwsh -File tools/build-data.ps1
Re-running is safe; downloads are cached in tools/.cache
#>

$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $PSScriptRoot '.cache'
$data  = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $cache, $data, (Join-Path $data 'svg') | Out-Null

function Get-Cached([string]$Url, [string]$File) {
    $path = Join-Path $cache $File
    if (-not (Test-Path $path)) {
        Write-Host "downloading $Url"
        Invoke-WebRequest -Uri $Url -UseBasicParsing -OutFile $path
    }
    return $path
}

function Write-Json($Object, [string]$Path, [int]$Depth = 8) {
    $json = $Object | ConvertTo-Json -Depth $Depth -Compress
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding $false))
    Write-Host ("  wrote {0} ({1:N0} KB)" -f (Split-Path $Path -Leaf), ((Get-Item $Path).Length / 1KB))
}

# ---------------------------------------------------------------- 1. kanji set
Write-Host '[1/6] kanji list + readings'

$kanjiDbPath = Get-Cached 'https://cdn.jsdelivr.net/gh/davidluzgouveia/kanji-data@master/kanji.json' 'kanji.json'
$kanjiDb = Get-Content $kanjiDbPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable

# The user's own N5 / N4 lists take priority (these follow Nihongo So-matome).
$userList = Get-Content (Join-Path $root 'Kanji_List.txt') -Raw -Encoding UTF8
$sections = [regex]::Split($userList, 'JLPT N\d Kanji')
$userN5 = [regex]::Matches($sections[1], '[\p{IsCJKUnifiedIdeographs}]') | ForEach-Object { $_.Value }
$userN4 = [regex]::Matches($sections[2], '[\p{IsCJKUnifiedIdeographs}]') | ForEach-Object { $_.Value }

$level = [ordered]@{}
foreach ($c in $userN5) { if (-not $level.Contains($c)) { $level[$c] = 5 } }
foreach ($c in $userN4) { if (-not $level.Contains($c)) { $level[$c] = 4 } }
# top up from KANJIDIC's modern JLPT tagging so nothing is missing
foreach ($lv in 5, 4, 3) {
    foreach ($c in $kanjiDb.Keys) {
        if ($kanjiDb[$c].jlpt_new -eq $lv -and -not $level.Contains($c)) { $level[$c] = $lv }
    }
}
$chars = @($level.Keys)
Write-Host ("  N5={0} N4={1} N3={2} total={3}" -f
    ($chars | Where-Object { $level[$_] -eq 5 }).Count,
    ($chars | Where-Object { $level[$_] -eq 4 }).Count,
    ($chars | Where-Object { $level[$_] -eq 3 }).Count,
    $chars.Count)

$inSet = [Collections.Generic.HashSet[char]]::new()
foreach ($c in $chars) { [void]$inSet.Add([char]$c) }

# ---------------------------------------------------------- 2. stroke order svg
Write-Host '[2/6] stroke order (KanjiVG)'

$zipPath = Get-Cached 'https://codeload.github.com/KanjiVG/kanjivg/zip/refs/heads/master' 'kanjivg.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
$svgText = @{}
try {
    foreach ($c in $chars) {
        $name = '{0:x5}.svg' -f [int][char]$c
        $entry = $zip.Entries | Where-Object { $_.FullName -like "*/kanji/$name" } | Select-Object -First 1
        if (-not $entry) { continue }
        $reader = New-Object IO.StreamReader($entry.Open(), [Text.Encoding]::UTF8)
        $svgText[$c] = $reader.ReadToEnd()
        $reader.Dispose()
    }
}
finally { $zip.Dispose() }

$strokeCount = @{}
$components = @{}
foreach ($c in $chars) {
    if (-not $svgText.ContainsKey($c)) { continue }
    $svg = $svgText[$c]
    # strip the "stroke number" layer, keep only the path group, and inline a tidy viewBox
    $body = [regex]::Match($svg, '(?s)<g id="kvg:StrokePaths[^>]*>.*?</g>\s*(?=<g id="kvg:StrokeNumbers|</svg>)').Value
    if (-not $body) { $body = [regex]::Match($svg, '(?s)<g id="kvg:StrokePaths.*?</svg>').Value -replace '</svg>', '' }
    $paths = [regex]::Matches($body, '\sd="([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
    $strokeCount[$c] = $paths.Count
    $out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 109 109">' +
    (($paths | ForEach-Object { '<path d="' + $_ + '"/>' }) -join '') + '</svg>'
    [IO.File]::WriteAllText((Join-Path $data ('svg/{0:x}.svg' -f [int][char]$c)), $out, (New-Object Text.UTF8Encoding $false))

    $set = [Collections.Generic.HashSet[string]]::new()
    foreach ($m in [regex]::Matches($svg, 'kvg:element="([^"]+)"')) {
        $e = $m.Groups[1].Value
        if ($e -ne $c) { [void]$set.Add($e) }
    }
    $components[$c] = $set
}
Write-Host ("  {0} stroke diagrams" -f $svgText.Count)

# -------------------------------------------------------------- 3. look-alikes
Write-Host '[3/6] visually similar kanji'

$similar = @{}
foreach ($a in $chars) {
    if (-not $components.ContainsKey($a)) { continue }
    $ca = $components[$a]
    $sa = $kanjiDb[$a].strokes
    $scored = foreach ($b in $chars) {
        if ($b -eq $a -or -not $components.ContainsKey($b)) { continue }
        $cb = $components[$b]
        if ($ca.Count -eq 0 -or $cb.Count -eq 0) { continue }
        $shared = 0; foreach ($x in $ca) { if ($cb.Contains($x)) { $shared++ } }
        if ($shared -eq 0) { continue }
        $union = $ca.Count + $cb.Count - $shared
        $score = $shared / $union
        $diff = [Math]::Abs($sa - $kanjiDb[$b].strokes)
        if ($diff -le 1) { $score += 0.25 } elseif ($diff -le 3) { $score += 0.1 }
        if ($score -ge 0.45) { [pscustomobject]@{ k = $b; s = $score } }
    }
    $top = $scored | Sort-Object -Property s -Descending | Select-Object -First 8
    if ($top) { $similar[$a] = @($top.k) }
}

# hand-picked classic confusions, merged on top of the automatic results
$confusions = @(
    '土士', '人入八', '日曰目自白百', '未末', '大犬太天夫', '千干午牛', '力刀万方',
    '右石左友', '木本休体体', '待持特', '問間聞開閉', '鳥島馬', '貝見具真',
    '王玉主住', '早草卓', '話活括', '名各客', '買売実', '雨雪電雲',
    '安案字学', '高同回向', '金全会合', '食飲館飯', '小少水氷永',
    '何荷河可', '時特持待', '休体休', '先洗生牛', '戸所新', '犬大丈',
    '白百自目', '中虫申田由甲', '北比化花', '去法会云', '上止正足',
    '思思想恩', '切分別分', '今令命会', '手毛年午', '工エ土士',
    '気汽完', '科料斗', '押抽押', '始治姉', '返近通週道進送',
    '練綿縮続読', '識職織', '複復腹', '勉免兔', '晴清請精情',
    '陽場揚湯', '困囲因回国図園', '買貸貨質賞', '暑者署暑', '薬楽葉',
    '代化他地', '住注往柱', '取最耳職', '発登着差', '号書昼',
    '夕名多外', '辛幸辞', '予矛子', '式試式', '役投設'
)
foreach ($grp in $confusions) {
    $members = $grp.ToCharArray() | ForEach-Object { [string]$_ } | Where-Object { $level.Contains($_) } | Select-Object -Unique
    foreach ($m in $members) {
        $others = @($members | Where-Object { $_ -ne $m })
        if (-not $others) { continue }
        $existing = @()
        if ($similar.ContainsKey($m)) { $existing = $similar[$m] }
        $similar[$m] = @(@($others + $existing) | Select-Object -Unique | Select-Object -First 8)
    }
}

# ------------------------------------------------------------------ 4. kanji.json
Write-Host '[4/6] kanji.json'

$kanjiOut = [ordered]@{}
foreach ($c in $chars) {
    $d = $kanjiDb[$c]
    $meanings = @()
    if ($d) {
        # "^" marks a secondary WaniKani meaning - drop the marker, keep the word
        $raw = @($d.meanings) + @($d.wk_meanings)
        $meanings = @($raw | Where-Object { $_ } |
            ForEach-Object { ($_.ToString().TrimStart('^') -replace '\([^)]*\)', '').ToLower().Trim(' ,') } |
            Where-Object { $_ -and $_ -notmatch 'radical' } | Select-Object -Unique -First 6)
    }
    if (-not $meanings) { $meanings = @('?') }
    $kanjiOut[$c] = [ordered]@{
        l  = $level[$c]
        s  = if ($strokeCount.ContainsKey($c)) { $strokeCount[$c] } elseif ($d) { $d.strokes } else { 0 }
        m  = $meanings
        on = @(if ($d) { $d.readings_on } else { @() })
        kn = @(if ($d) { $d.readings_kun } else { @() })
        sim = @(if ($similar.ContainsKey($c)) { $similar[$c] } else { @() })
    }
}
Write-Json $kanjiOut (Join-Path $data 'kanji.json') 6

# ---------------------------------------------------------------- 5. vocabulary
Write-Host '[5/6] vocabulary'

$wordsByKanji = @{}
foreach ($c in $chars) { $wordsByKanji[$c] = [Collections.Generic.List[object]]::new() }
$allWords = [Collections.Generic.List[object]]::new()

foreach ($lv in 5, 4, 3) {
    $csv = Import-Csv (Get-Cached "https://cdn.jsdelivr.net/gh/jamsinclair/open-anki-jlpt-decks@main/src/n$lv.csv" "vocab-n$lv.csv") -Encoding UTF8
    foreach ($row in $csv) {
        $expr = $row.expression
        if ([string]::IsNullOrWhiteSpace($expr)) { continue }
        # keep only words written entirely with kanji from the N5-N3 syllabus
        $outOfScope = $false
        $kanjiInWord = [Collections.Generic.List[string]]::new()
        foreach ($ch in $expr.ToCharArray()) {
            if ($ch -ge [char]0x4E00 -and $ch -le [char]0x9FFF) {
                if (-not $inSet.Contains($ch)) { $outOfScope = $true; break }
                if (-not $kanjiInWord.Contains([string]$ch)) { $kanjiInWord.Add([string]$ch) }
            }
        }
        if ($outOfScope -or $kanjiInWord.Count -eq 0) { continue }
        $meaning = ($row.meaning -replace '\s+', ' ').Trim()
        if ($meaning.Length -gt 90) { $meaning = $meaning.Substring(0, 90).TrimEnd(', ') + '…' }
        $entry = [ordered]@{ w = $expr; r = $row.reading; m = $meaning; l = $lv }
        $allWords.Add($entry)
        foreach ($k in $kanjiInWord) {
            if ($wordsByKanji[$k].Count -lt 12) { $wordsByKanji[$k].Add($entry) }
        }
    }
}

$wordsOut = [ordered]@{}
foreach ($c in $chars) {
    # a handful of kanji have no deck entry - fall back to the kanji used as a word on its own
    if ($wordsByKanji[$c].Count -eq 0) {
        $solo = @($kanjiDb[$c].readings_kun) | Where-Object { $_ -and $_ -notmatch '[.\-]' } | Select-Object -First 1
        if ($solo) { $wordsByKanji[$c].Add([ordered]@{ w = $c; r = $solo; m = ($kanjiOut[$c].m -join ', '); l = $level[$c] }) }
    }
    if ($wordsByKanji[$c].Count) { $wordsOut[$c] = $wordsByKanji[$c] }
}
Write-Json $wordsOut (Join-Path $data 'words.json') 6
Write-Host ("  {0} vocabulary entries" -f $allWords.Count)

# ---------------------------------------------------------------- 6. sentences
Write-Host '[6/7] example sentences (Tanaka corpus)'

$gz = Get-Cached 'http://ftp.edrdg.org/pub/Nihongo/examples.utf.gz' 'examples.utf.gz'
$plain = Join-Path $cache 'examples.utf'
if (-not (Test-Path $plain)) {
    $in = [IO.File]::OpenRead($gz)
    $out = [IO.File]::Create($plain)
    $gzs = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
    $gzs.CopyTo($out); $gzs.Dispose(); $out.Dispose(); $in.Dispose()
}

$sentencesByKanji = @{}
foreach ($c in $chars) { $sentencesByKanji[$c] = [Collections.Generic.List[object]]::new() }

$reader = New-Object IO.StreamReader($plain, [Text.Encoding]::UTF8)
$kept = 0
while ($null -ne ($line = $reader.ReadLine())) {
    if (-not $line.StartsWith('A: ')) { continue }
    $parts = $line.Substring(3).Split("`t")
    if ($parts.Count -lt 2) { continue }
    $ja = $parts[0]
    if ($ja.Length -gt 34) { continue }
    $en = ($parts[1] -replace '#ID=.*$', '').Trim()
    if ($en.Length -lt 4 -or $en.Length -gt 110) { continue }

    $hits = $null
    $ok = $true
    foreach ($ch in $ja.ToCharArray()) {
        if ($ch -ge [char]0x4E00 -and $ch -le [char]0x9FFF) {
            if (-not $inSet.Contains($ch)) { $ok = $false; break }   # out-of-syllabus kanji
            if ($null -eq $hits) { $hits = [Collections.Generic.HashSet[string]]::new() }
            [void]$hits.Add([string]$ch)
        }
    }
    if (-not $ok -or $null -eq $hits) { continue }
    $entry = $null
    foreach ($k in $hits) {
        $bucket = $sentencesByKanji[$k]
        if ($bucket.Count -lt 5) {
            if ($null -eq $entry) { $entry = [ordered]@{ j = $ja; e = $en }; $kept++ }
            $bucket.Add($entry)
        }
    }
}
$reader.Dispose()

$sentOut = [ordered]@{}
foreach ($c in $chars) { if ($sentencesByKanji[$c].Count) { $sentOut[$c] = $sentencesByKanji[$c] } }
Write-Json $sentOut (Join-Path $data 'sentences.json') 6
Write-Host ("  {0} sentences, {1} kanji covered" -f $kept, $sentOut.Count)

# ------------------------------------------------------- 7. meaning categories
Write-Host '[7/7] meaning groups'

$groupDefs = [ordered]@{
    'Numbers & counting'  = 'one,two,three,four,five,six,seven,eight,nine,ten,hundred,thousand,ten thousand,number,count,counter,half,several,digit,unit,degree'
    'Time & calendar'     = "time,day,month,year,week,hour,minute,second,morning,evening,night,noon,now,previous,next,past,future,season,spring,summer,autumn,fall,winter,age,period,term,early,late,o'clock,daytime,nightfall,yesterday,beforehand"
    'Nature & weather'    = 'mountain,river,sea,ocean,rain,snow,wind,sky,sun,moon,star,fire,water,tree,wood,forest,field,stone,flower,grass,earth,soil,weather,cloud,light,heat,cold,warm,cool,ice,lake,pond,island,smoke,nature'
    'Body & health'       = 'body,head,face,eye,ear,mouth,hand,foot,leg,heart,blood,bone,hair,tooth,finger,neck,belly,abdomen,back,sick,illness,disease,medicine,doctor,pain,tired,sleep,breath,life,death,die,born,birth'
    'People & family'     = 'person,people,man,woman,child,father,mother,brother,sister,family,friend,husband,wife,self,oneself,everyone,adult,baby,daughter,son,guest,king,ruler,mister,you,he,she,somebody'
    'Places & buildings'  = 'house,home,school,shop,store,station,city,town,village,country,nation,road,path,building,room,hall,garden,park,temple,hospital,office,place,harbor,bank,market,inn,ward,district,capital,prefecture,seat,window,door,gate,floor'
    'Movement & travel'   = 'go,come,return,walk,run,enter,exit,leave,ride,board,descend,move,travel,fly,stop,pass,cross,chase,escape,advance,progress,send,arrive,carry,transport,transit,drive,follow,climb,ascend,fall,drop,flow'
    'Language & talking'  = 'say,speak,talk,word,language,read,write,listen,hear,ask,question,answer,letter,story,explain,theory,report,discuss,debate,call,name,character,writing,note,record,sentence,translate,meaning,inquire'
    'Study & work'        = 'learn,study,teach,education,school,research,exam,test,examination,practice,work,job,business,company,employee,duty,skill,art,technique,profession,labor,office,subject,science,knowledge,remember,memorize,thesis,homework,diligence'
    'Food & drink'        = 'eat,drink,rice,meat,fish,vegetable,tea,sake,alcohol,taste,flavor,cook,sweet,meal,bread,egg,fruit,salt,sugar,hunger,hungry,bean,milk,soup,dish'
    'Size & quantity'     = 'big,large,small,little,many,much,few,long,short,high,tall,low,wide,broad,narrow,deep,shallow,heavy,light,thick,thin,increase,decrease,full,all,whole,most,more,less,extreme,add,total,amount,enough,surplus,lack'
    'Emotions & mind'     = 'love,affection,like,fond,hate,happy,happiness,sad,grieve,angry,anger,fear,dread,worry,think,thought,feel,feeling,emotion,mind,spirit,soul,dream,hope,wish,surprise,laugh,cry,lonely,suffer,pleasure,rejoice,comfort,calm,quiet'
    'Direction & position'= 'up,down,above,below,left,right,inside,within,outside,front,back,behind,middle,center,north,south,east,west,side,between,near,far,distant,direction,opposite,facing,top,bottom,corner,surface,edge,beside'
    'Colour & appearance' = 'color,white,black,red,blue,green,yellow,brown,bright,dark,beautiful,beauty,shape,form,appearance,picture,drawing,image,photograph,pattern,clean,dirty,new,old,young'
    'Money & commerce'    = 'money,buy,sell,price,cost,expense,pay,profit,value,wealth,property,assets,trade,goods,product,fee,economy,yen,sale,salary,wage,gold,bank,rich,poor,borrow,lend,debt'
    'Actions & making'    = 'make,build,create,produce,take,give,put,place,hold,use,open,close,shut,break,cut,push,pull,wash,wear,begin,start,end,finish,decide,help,wait,meet,find,search,choose,select,change,repair,throw,hit,catch,carry,fix,prepare'
    'Society & rules'     = 'government,politics,law,rule,system,public,power,authority,right,crime,punish,police,war,battle,peace,group,association,member,organization,citizen,people,nation,election,agreement,contract,order,manner,ceremony'
}

$groupsOut = [ordered]@{}
foreach ($name in $groupDefs.Keys) {
    $keywords = $groupDefs[$name] -split ','
    $members = foreach ($c in $chars) {
        $text = ($kanjiOut[$c].m -join '|')
        $hit = $false
        foreach ($kw in $keywords) {
            if ($text -match ('(^|\||\s|-)' + [regex]::Escape($kw.Trim()) + '($|\||\s|-|s\b|ing\b)')) { $hit = $true; break }
        }
        if ($hit) { $c }
    }
    if (@($members).Count -ge 3) { $groupsOut[$name] = @($members) }
}
Write-Json $groupsOut (Join-Path $data 'groups.json') 4
Write-Host ("  {0} groups" -f $groupsOut.Count)

Write-Host 'done.'
